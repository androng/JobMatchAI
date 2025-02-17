const { log } = require('./loggingService');

function filterDuplicateJobs(existingJobs, newJobs) {
    log('INFO', 'Using Job Link to filter duplicate jobs...');
    const existingLinks = new Set(existingJobs.map(row => row[4] || "")); // Column E: Job Link
    const uniqueJobs = newJobs.filter(job => !existingLinks.has(job.jobUrl));
    log('INFO', `${uniqueJobs.length} jobs are unique.`);
    return uniqueJobs;
}

module.exports = { filterDuplicateJobs };
