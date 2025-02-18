const { google } = require('googleapis');
const sheets = google.sheets('v4');
const credentials = JSON.parse(require('fs').readFileSync('google_service_account_credentials.json'));
const { log } = require('./loggingService');
import { Job, JobAiResponses } from '../types';

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function readJobsFromSheet() {
    log('INFO', 'Reading jobs from Google Sheets...');
    const client = await auth.getClient();
    const range = "Sheet1!A1:H";

    if(SPREADSHEET_ID == null || SPREADSHEET_ID == ""){
        log('ERROR', 'spreadsheet ID is empty');
        throw new Error();
    }
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range,
            auth: client,
        });
        const rows = response.data.values || [];
        log('INFO', `Successfully read ${rows.length} rows from Google Sheets.`);
        return rows;
    } catch (error) {
        log('ERROR', 'Error reading jobs from Google Sheets.', { error: (error as Error).message });
        throw error;
    }
}

async function writeJobToSheet(job: Job, jobAiResponses: JobAiResponses) {
    log('INFO', 'Writing a job to Google Sheets...');
    const client = await auth.getClient();
    const range = "Sheet1!A2";

    const { gptJobSummary, gptJobMatchPercentage, deepSeekJobSummary, deepSeekJobMatchPercentage } = jobAiResponses
    const values = [
        [
            job.title || "",
            job.companyName || "",
            job.location || "",
            job.publishedAt || "",
            job.jobUrl || "",
            job.contractType || "",
            job.posterProfileUrl || "",
            gptJobMatchPercentage,
            gptJobSummary,
            deepSeekJobMatchPercentage,
            deepSeekJobSummary
        ],
    ];

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range,
            valueInputOption: "USER_ENTERED",
            resource: { values },
            auth: client,
        });
        log('INFO', 'Job successfully written to Google Sheets.');
    } catch (error) {
        log('ERROR', 'Error writing job to Google Sheets.', { error: (error as Error).message });
        throw error;
    }
}

module.exports = { readJobsFromSheet, writeJobToSheet };
