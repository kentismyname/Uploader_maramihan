const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const axios = require('axios');

// Define file paths
const pdfFolder = path.join(__dirname, 'pdf_files/');
const processedFolder = path.join(__dirname, 'processed/');

// Create the 'processed' folder if it doesn't exist
if (!fs.existsSync(processedFolder)) {
    fs.mkdirSync(processedFolder);
}

// Extract text from PDF
async function extractPdfText(filePath) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    } catch (error) {
        console.error('Error parsing PDF:', error);
        return null;
    }
}

// Function to format phone number as (xxx) xxx - xxxx
function formatPhoneNumber(phone) {
    if (phone.length === 10) {
        return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)} - ${phone.slice(6)}`;
    }
    return phone; // Return the original if not a 10-digit number
}

// Parse extracted PDF text
function parsePdfText(text) {
    // Normalize spaces
    const normalizedText = text.replace(/\s+/g, ' ');

    // Initialize record object with default values
    const record = {
        type: 'Received',
        from: null,
        to: '(207) 261 - 0798',
        subject: 'PRIOR AUTHORIZATION PRESCRIPTION REQUEST',
        sender: null,
        createdAt: null
    };

    console.log('--- Extracting fields from PDF text ---');

    // Enhanced 'createdAt' extraction with more flexible regex
    const createdAtMatch = normalizedText.match(/(\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} [P]M)/);
    if (createdAtMatch) {
        // Convert 'createdAt' to 'YYYY-MM-DD HH:MM:SS' format
        const dateStr = createdAtMatch[1];
        const dateObj = new Date(dateStr);
        if (!isNaN(dateObj)) {
            // Format the date to 'YYYY-MM-DD HH:MM:SS'
            const yyyy = dateObj.getFullYear();
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const hh = String(dateObj.getHours()).padStart(2, '0');
            const min = String(dateObj.getMinutes()).padStart(2, '0');
            const ss = String(dateObj.getSeconds()).padStart(2, '0');
            record.createdAt = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
        }
    }
    console.log('Extracted createdAt:', record.createdAt);

    // Match 'from' (Fax number)
    const fromMatch = normalizedText.match(/Fax:\s*([0-9-]+)/i);
    if (fromMatch) {
        const cleanedFrom = fromMatch[1].replace(/\D/g, ''); // Remove non-digit characters
        record.from = formatPhoneNumber(cleanedFrom); // Format the phone number
    }
    console.log('Extracted from:', record.from);

    // Enhanced regex for 'PHYSICIAN NAME' detection
    const senderMatch = normalizedText.match(
        /PHYSICIAN INFORMATION\s*([A-Z\s,\.]+(?:MD|M\.D\.|DO|D\.O\.|APN|N\.P\.|M\.D|D\.O|APRN|M\.D|APRN\.))/i
    );

    if (senderMatch) {
        record.sender = senderMatch[1].trim();
    } else {
        // Fallback: Match directly after 'PHYSICIAN NAME' label
        const fallbackMatch = normalizedText.match(/PHYSICIAN NAME\s*[:\-]?\s*([A-Z\s,\.]+)/i);
        if (fallbackMatch) {
            record.sender = fallbackMatch[1].trim();
        }
    }

    console.log('Matched PHYSICIAN NAME:', record.sender);

    // Check if all required fields are present
    if (record.createdAt && record.from && record.sender) {
        console.log('--- All fields successfully extracted ---');
        return record;
    } else {
        console.log('Required fields missing in the PDF.');
        return null;
    }
}

// Prepare records for bulk upload
async function prepareRecordsForUpload(pdfFiles) {
    const records = [];

    for (const file of pdfFiles) {
        const filePath = path.join(pdfFolder, file);
        console.log(`\n--- Processing file: ${file} ---`);

        const pdfText = await extractPdfText(filePath);
        if (pdfText) {
            const record = parsePdfText(pdfText);
            if (record) {
                record.attachment = fileToBase64(filePath);
                record.file_extension = 'pdf';
                records.push(record);

                // Close the file and move it to 'processed' folder
                try {
                    const processedPath = path.join(processedFolder, file);
                    fs.renameSync(filePath, processedPath);
                    console.log(`Moved file to processed folder: ${file}`);
                } catch (error) {
                    console.error(`Error moving file: ${error.message}`);
                }
            }
        } else {
            console.log(`Failed to extract text from ${file}`);
        }
    }

    return records;
}

// Convert file to base64
function fileToBase64(filePath) {
    const fileContent = fs.readFileSync(filePath);
    return Buffer.from(fileContent).toString('base64');
}

// Bulk upload function
async function bulkUpload(records) {
    try {
        const response = await axios.post('https://humble-fax.com/upload_bulk', {
            records: records
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        // Debug log to ensure payload sent correctly
        console.log('Payload sent:', JSON.stringify(records, null, 2));
        console.log('Response:', response.data);
    } catch (error) {
        console.error('Error uploading records:', error.response ? error.response.data : error.message);
    }
}

// Main process
(async function main() {
    try {
        const pdfFiles = fs.readdirSync(pdfFolder).filter(file => file.endsWith('.pdf'));
        const recordsForUpload = await prepareRecordsForUpload(pdfFiles);

        if (recordsForUpload.length > 0) {
            console.log(`Preparing to upload ${recordsForUpload.length} records...`);
            await bulkUpload(recordsForUpload);
        } else {
            console.log('No valid records found for upload.');
        }
    } catch (error) {
        console.error('Error processing PDFs:', error.message);
    }
})();
