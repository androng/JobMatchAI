import fs from 'fs';
import { log } from './loggingService.js';


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

export { readJSONFromFile };
