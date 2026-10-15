/** Europe/Warsaw midnight has the offset before the 01:00 UTC DST transition. */
export function warsawMidnight(date: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(`${date}T00:00:00Z`));
  const offset =
    parts.find((part) => part.type === 'timeZoneName')?.value === 'GMT+2' ? '+02:00' : '+01:00';
  return `${date}T00:00:00${offset}`;
}

export function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
