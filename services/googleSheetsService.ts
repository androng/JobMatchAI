import { google } from 'googleapis';
import fs from 'fs';
import { log } from './loggingService.js';
import { Job, JobAiResponses } from '../types.js';

const sheets = google.sheets('v4');
const credentials = JSON.parse(fs.readFileSync('google_service_account_credentials.json', 'utf8'));

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
        } as any);
        const rows = (response as any).data.values || [];
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

    const values = [
        [
            job.title || "",
            job.companyName || "",
            job.location || "",
            job.jobUrl || "",
            job.pay || "",
            job.contractType || "",
            job.source || "",
            jobAiResponses.gptJobMatchPercentage || "",
            jobAiResponses.gptJobSummary || "",
            jobAiResponses.date_generated || ""
        ],
    ];

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range,
            valueInputOption: "USER_ENTERED",
            resource: { values },
            auth: client,
        } as any);
        log('INFO', 'Job successfully written to Google Sheets.');
    } catch (error) {
        log('ERROR', 'Error writing job to Google Sheets.', { error: (error as Error).message });
        throw error;
    }
}
async function writeJobsToSheet(jobs: Job[], jobAiResponses: JobAiResponses[]) {
    log('INFO', 'Writing jobs to Google Sheets...');
    const client = await auth.getClient();
    const range = "Sheet1!A2";

    let values: string[][] = [];
    for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const jobAiResponse = jobAiResponses[i];
        values.push(
            [
                job.title || "",
                job.companyName || "",
                job.location || "",
                job.jobUrl || "",
                job.pay || "",
                job.contractType || "",
                job.source || "",
                jobAiResponse.gptJobMatchPercentage || "",
                jobAiResponse.gptJobSummary || "",
                jobAiResponse.date_generated.toISOString() || ""
            ],
        );
    }

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range,
            valueInputOption: "USER_ENTERED",
            resource: { values },
            auth: client,
        } as any);
        log('INFO', 'Jobs successfully written to Google Sheets.');
    } catch (error) {
        log('ERROR', 'Error writing jobs to Google Sheets.', { error: (error as Error).message });
        throw error;
    }
}


export { readJobsFromSheet, writeJobToSheet, writeJobsToSheet };
