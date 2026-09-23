/**
 * US Equity Market Hours (Regular Trading Hours — RTH)
 *
 * NYSE & NASDAQ cash sessions operate Monday through Friday, 9:30 AM – 4:00 PM US Eastern Time,
 * excluding official exchange holidays.
 */

export interface MarketHoursStatus {
  isOpen: boolean;
  session: 'regular' | 'closed' | 'pre-market' | 'after-hours';
  label: string;
  easternTime: string;
}

const NY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
});

/** Major fixed or simple observed US exchange holidays */
function isUSMarketHoliday(year: number, month: number, day: number, weekday: string): boolean {
  // New Year's Day (Jan 1)
  if (month === 1 && day === 1) return true;
  // If Jan 1 is Sunday, observed Jan 2
  if (month === 1 && day === 2 && weekday === 'Mon') return true;

  // Juneteenth (June 19)
  if (month === 6 && day === 19) return true;
  if (month === 6 && day === 20 && weekday === 'Mon') return true;
  if (month === 6 && day === 18 && weekday === 'Fri') return true;

  // Independence Day (July 4)
  if (month === 7 && day === 4) return true;
  if (month === 7 && day === 5 && weekday === 'Mon') return true;
  if (month === 7 && day === 3 && weekday === 'Fri') return true;

  // Christmas (Dec 25)
  if (month === 12 && day === 25) return true;
  if (month === 12 && day === 26 && weekday === 'Mon') return true;
  if (month === 12 && day === 24 && weekday === 'Fri') return true;

  // MLK Day: 3rd Monday in January (days 15-21)
  if (month === 1 && weekday === 'Mon' && day >= 15 && day <= 21) return true;

  // Washington's Birthday / Presidents Day: 3rd Monday in February (days 15-21)
  if (month === 2 && weekday === 'Mon' && day >= 15 && day <= 21) return true;

  // Memorial Day: Last Monday in May (days 25-31)
  if (month === 5 && weekday === 'Mon' && day >= 25) return true;

  // Labor Day: First Monday in September (days 1-7)
  if (month === 9 && weekday === 'Mon' && day <= 7) return true;

  // Thanksgiving Day: 4th Thursday in November (days 22-28)
  if (month === 11 && weekday === 'Thu' && day >= 22 && day <= 28) return true;

  return false;
}

/**
 * Check whether the US equity cash market (NYSE/NASDAQ) is currently in Regular Trading Hours.
 */
export function getUSEquityMarketStatus(date: Date = new Date()): MarketHoursStatus {
  const parts = Object.fromEntries(
    NY_FORMATTER.formatToParts(date).map((p) => [p.type, p.value]),
  );

  const weekday = parts.weekday ?? 'Mon';
  const year    = parseInt(parts.year ?? '2026', 10);
  const month   = parseInt(parts.month ?? '1', 10);
  const day     = parseInt(parts.day ?? '1', 10);
  const hour    = parseInt(parts.hour ?? '0', 10);
  const minute  = parseInt(parts.minute ?? '0', 10);

  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ET`;

  // Weekends
  if (weekday === 'Sat' || weekday === 'Sun') {
    return {
      isOpen: false,
      session: 'closed',
      label: 'Market closed',
      easternTime: timeStr,
    };
  }

  // Holidays
  if (isUSMarketHoliday(year, month, day, weekday)) {
    return {
      isOpen: false,
      session: 'closed',
      label: 'Market closed',
      easternTime: timeStr,
    };
  }

  const minutesFromMidnight = hour * 60 + minute;

  // Regular Trading Hours (RTH): 9:30 AM (570m) to 4:00 PM (960m)
  if (minutesFromMidnight >= 570 && minutesFromMidnight < 960) {
    return {
      isOpen: true,
      session: 'regular',
      label: 'Market open',
      easternTime: timeStr,
    };
  }

  // Pre-market: 4:00 AM (240m) to 9:30 AM (570m)
  if (minutesFromMidnight >= 240 && minutesFromMidnight < 570) {
    return {
      isOpen: false,
      session: 'pre-market',
      label: 'Market closed',
      easternTime: timeStr,
    };
  }

  // After-hours: 4:00 PM (960m) to 8:00 PM (1200m)
  if (minutesFromMidnight >= 960 && minutesFromMidnight < 1200) {
    return {
      isOpen: false,
      session: 'after-hours',
      label: 'Market closed',
      easternTime: timeStr,
    };
  }

  return {
    isOpen: false,
    session: 'closed',
    label: 'Market closed',
    easternTime: timeStr,
  };
}
