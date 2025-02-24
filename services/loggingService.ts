function log(level: string, message: string, context = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`, context ?? null);
}

export { log };
