const { log } = require('./loggingService');
import { Job } from '../types';

function normalizeString(str: string): string {
    return str
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/[^\w\s-]/g, ''); // Remove special characters except hyphen
}

function filterDuplicateJobs(existingJobs: any[], newJobs: Job[]) {
    log('INFO', 'Removing duplicate jobs...');
    // Create a composite key by concatenating columns 0, 1, and 2  
    //`${job.title}_${job.companyName}_${job.location}`
    // This is to avoid duplicate jobs across different websites like ZipRecruiter and LinkedIn where 
    // the URLs are different but the job is the same.
    // This assumes the Google Sheet has the columns in the order: title, companyName, location.
    const existingCompositeKeys = new Set(
        // the row object comes from Google Sheet so it's just an array of strings and 
        // could be messed up if the columns are not in the right order
        existingJobs.map((row: any) => {
            const normalizedTitle = normalizeString(row[0] || '');
            const normalizedCompany = normalizeString(row[1] || '');
            const normalizedLocation = normalizeString(row[2] || '');
            return `${normalizedTitle}_${normalizedCompany}_${normalizedLocation}`;
        })
    );
    
    const uniqueJobs = newJobs.filter(job => {
        const normalizedTitle = normalizeString(job.title);
        const normalizedCompany = normalizeString(job.companyName);
        const normalizedLocation = normalizeString(job.location);
        const compositeKey = `${normalizedTitle}_${normalizedCompany}_${normalizedLocation}`;
        return !existingCompositeKeys.has(compositeKey);
    });
    log('INFO', `${uniqueJobs.length} jobs are new.`);
    return uniqueJobs;
}

module.exports = { filterDuplicateJobs };
