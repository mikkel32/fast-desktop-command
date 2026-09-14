// Shared with the lazy factory so extension checks never load the Excel engine.
export function isExcelPath(filePath: string): boolean {
    return /\.(xlsx|xls|xlsm)$/i.test(filePath);
}
