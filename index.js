const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const axios = require('axios');

// Define file paths
const pdfFolder = path.join(__dirname, 'pdf_files/');
const processedFolder = path.join(__dirname, 'processed/');
const failedFolder = path.join(__dirname, 'failed uploads for sent/');

// Create folders if they don't exist
if (!fs.existsSync(processedFolder)) {
    fs.mkdirSync(processedFolder);
}
if (!fs.existsSync(failedFolder)) {
    fs.mkdirSync(failedFolder);
}

// Extract text from PDF
async function extractPdfText(filePath) {
    try {
        console.log(`Reading PDF file: ${filePath}`);
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        console.log(`Successfully extracted text from: ${filePath}`);
        return data.text;
    } catch (error) {
        console.error(`Error parsing PDF (${filePath}):`, error);
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
    const normalizedText = text.replace(/\s+/g, ' ');
    const record = {
        type: 'Sent',
        to: '(207) 261 - 0798',
        from: null,
        subject: 'PRIOR AUTHORIZATION PRESCRIPTION REQUEST',
        sender: 'RIGHT CHOICE MEDICAL SUPPLY',
        createdAt: null
    };

    // Match 'createdAt' with regex
    const createdAtMatch = normalizedText.match(/(\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} [AP]M)/);
    if (createdAtMatch) {
        const [month, day, year, hour, minute, period] = createdAtMatch[1].match(/(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) ([AP]M)/).slice(1);

        let adjustedHour = parseInt(hour);
        if (period === 'PM' && adjustedHour !== 12) adjustedHour += 12;
        if (period === 'AM' && adjustedHour === 12) adjustedHour = 0;

        const yyyy = year;
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const hh = String(adjustedHour).padStart(2, '0');
        const min = String(minute).padStart(2, '0');
        const ss = '00';
        record.createdAt = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    } else {
        console.log('No "createdAt" found in the text.');
    }

    // Match 'from' (Fax number)
    const fromMatch = normalizedText.match(/Fax:\s*([0-9-]+)/i);
    if (fromMatch) {
        const cleanedFrom = fromMatch[1].replace(/\D/g, '');
        record.from = formatPhoneNumber(cleanedFrom);
    } else {
        console.log('No "from" (Fax) found in the text.');
    }

    console.log('Parsed record:', record);

    // Validate the record
    if (record.createdAt && record.from && record.sender) {
        return record;
    } else {
        console.error('Incomplete record:', record);
        return null;
    }
}

// Prepare records for bulk upload
async function prepareRecordsForUpload(pdfFiles) {
    const records = [];
    const failedFiles = [];

    for (const file of pdfFiles) {
        const filePath = path.join(pdfFolder, file);
        console.log(`\nProcessing file: ${file}`);

        const pdfText = await extractPdfText(filePath);
        if (pdfText) {
            const record = parsePdfText(pdfText);
            if (record) {
                record.attachment = fileToBase64(filePath);
                record.file_extension = 'pdf';
                records.push(record);

                // Move file to 'processed' folder
                try {
                    const processedPath = path.join(processedFolder, file);
                    fs.renameSync(filePath, processedPath);
                    console.log(`Moved file to processed folder: ${file}`);
                } catch (error) {
                    console.error(`Error moving file: ${error.message}`);
                }
            } else {
                failedFiles.push(file);
            }
        } else {
            failedFiles.push(file);
        }
    }

    // Move failed files to the 'failed uploads for sent' folder
    for (const file of failedFiles) {
        try {
            const failedPath = path.join(failedFolder, file);
            fs.renameSync(path.join(pdfFolder, file), failedPath);
            console.log(`Moved file to failed uploads folder: ${file}`);
        } catch (error) {
            console.error(`Error moving failed file: ${error.message}`);
        }
    }

    return records;
}

// Convert file to base64
function fileToBase64(filePath) {
    const fileContent = fs.readFileSync(filePath);
    return Buffer.from(fileContent).toString('base64');
}

// Batch the upload requests
async function batchUpload(records, batchSize = 100) {
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        try {
            console.log(`Uploading batch ${i / batchSize + 1} of ${Math.ceil(records.length / batchSize)}...`);
            const response = await axios.post('http://localhost/humblefax/upload_bulk', {
                records: batch
            }, {
                headers: { 'Content-Type': 'application/json' }
            });
            console.log(`Batch ${i / batchSize + 1} uploaded successfully. Response:`, response.data);
        } catch (error) {
            if (error.response) {
                console.error('Error response:', error.response.data);
            } else {
                console.error('Error uploading batch:', error.message);
            }
        }
    }
}

// Main process
(async function main() {
    try {
        const pdfFiles = fs.readdirSync(pdfFolder).filter(file => file.endsWith('.pdf'));
        const recordsForUpload = await prepareRecordsForUpload(pdfFiles);

        if (recordsForUpload.length > 0) {
            console.log(`Preparing to upload ${recordsForUpload.length} records...`);
            await batchUpload(recordsForUpload, 100); // Upload in batches of 100
        } else {
            console.log('No valid records found for upload.');
        }

        console.log(`Total processed PDF files: ${fs.readdirSync(processedFolder).filter(file => file.toLowerCase().endsWith('.pdf')).length}`);
    } catch (error) {
        console.error('Error processing PDFs:', error.message);
    }
})();
