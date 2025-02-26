import { log } from './loggingService.js';
import { Job } from '../types.js';

function normalizeString(str: string): string {
    return str
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/[^\w\s-]/g, '') // Remove special characters except hyphen
        
        // remove anything after the first comma. the searches are already filtered 
        // to a radius of X miles so we don't need to worry about two cities with same name. 
        // This helps to filter things like "Remote, US" or "Remote, CA" or "Los Angeles, CA" 
        // vs "Los Angeles"
        .split(',')[0]; 
}
function getCompositeKey(title: string, company: string, location: string): string {
    return `${normalizeString(title)}_${normalizeString(company)}_${normalizeString(location)}`;
}

function filterDuplicateJobs(existingJobs: any[], newJobs: Job[]) {
    log('INFO', 'Removing duplicate jobs...');

    // Create a composite key by concatenating columns 0, 1, and 2  
    // This is to avoid duplicate jobs across different websites like ZipRecruiter and LinkedIn where 
    // the URLs are different but the job is the same.
    // This assumes the Google Sheet has the columns in the order: title, companyName, location.
    const existingKeys = new Set(
        // the row object comes from Google Sheet so it's just an array of strings and 
        // could be messed up if the columns are not in the right order
        existingJobs.map(row => getCompositeKey(row[0] || '', row[1] || '', row[2] || ''))
    );

    // Create Map of new jobs using composite key - this automatically deduplicates
    // jobs that have the same title, company, and location
    const newJobsMap = new Map(
        newJobs.map(job => [
            getCompositeKey(job.title, job.companyName, job.location),
            job
        ])
    );

    // Filter out any jobs that already exist in the Google Sheet
    const uniqueJobs = Array.from(newJobsMap.values())
        .filter(job => !existingKeys.has(getCompositeKey(job.title, job.companyName, job.location)));

    log('INFO', `${uniqueJobs.length} jobs are new.`);
    return uniqueJobs;
}
export { filterDuplicateJobs };
