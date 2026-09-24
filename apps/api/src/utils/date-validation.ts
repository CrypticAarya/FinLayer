export interface ValidatedDateRange {
  startDate?: Date;
  endDate?: Date;
  startDateStr?: string;
  endDateStr?: string;
}

/**
 * Validates fromDate and toDate query parameters:
 * - Must strictly match YYYY-MM-DD
 * - Must be a valid calendar date (e.g. 2026-02-30 is rejected)
 * - fromDate must be <= toDate
 * - Evaluated with UTC boundaries (00:00:00.000 to 23:59:59.999)
 */
export function validateDateRange(
  fromDate?: string,
  toDate?: string
): { valid: true; range: ValidatedDateRange } | { valid: false; error: string } {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let startDateStr: string | undefined;
  let endDateStr: string | undefined;

  if (fromDate !== undefined && fromDate !== "") {
    if (!dateRegex.test(fromDate)) {
      return { valid: false, error: `Invalid fromDate format: "${fromDate}". Expected YYYY-MM-DD.` };
    }
    const parts = fromDate.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (
      dateObj.getUTCFullYear() !== y ||
      dateObj.getUTCMonth() !== m - 1 ||
      dateObj.getUTCDate() !== d
    ) {
      return { valid: false, error: `Invalid calendar date for fromDate: "${fromDate}".` };
    }
    startDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
    startDateStr = fromDate;
  }

  if (toDate !== undefined && toDate !== "") {
    if (!dateRegex.test(toDate)) {
      return { valid: false, error: `Invalid toDate format: "${toDate}". Expected YYYY-MM-DD.` };
    }
    const parts = toDate.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (
      dateObj.getUTCFullYear() !== y ||
      dateObj.getUTCMonth() !== m - 1 ||
      dateObj.getUTCDate() !== d
    ) {
      return { valid: false, error: `Invalid calendar date for toDate: "${toDate}".` };
    }
    endDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    endDateStr = toDate;
  }

  if (startDate && endDate && startDate > endDate) {
    return {
      valid: false,
      error: `fromDate ("${fromDate}") must be less than or equal to toDate ("${toDate}").`,
    };
  }

  return {
    valid: true,
    range: { startDate, endDate, startDateStr, endDateStr },
  };
}
