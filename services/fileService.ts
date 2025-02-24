import fs from 'fs';
import { log } from './loggingService.js';

function readJobsFromFile(filename: string) {
    log('INFO', `Reading jobs from file: ${filename}`);
    try {
        const content = fs.readFileSync(filename, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        log('ERROR', 'Error reading jobs from file.', { error: (error as Error).message });
        throw error;
    }
}

function readJSONFromFile(filename: string) {
    log('INFO', `Reading JSON file: ${filename}`);
    try {
        const content = fs.readFileSync(filename, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        log('ERROR', 'Error reading JSON file.', { error: (error as Error).message });
        throw error;
    }
}

export { readJobsFromFile, readJSONFromFile };
