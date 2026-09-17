export default operation;
/**
 * Ensures the directory containing `filePath` exists, creating any missing parent directories
 * along the way (like `mkdir -p`).
 * @param {string} filePath
 * @returns {Promise<true>}
 */
declare function operation(filePath: string): Promise<true>;
