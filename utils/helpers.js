/**
 * Format the current date or a given date based on timezone.
 * @param {string} [timezone] - user timezone
 * @returns {object} - { dayOfWeek, date, month, year }
 */
export const formatDate = (timezone) => {
  const now = new Date();
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let dayOfWeek = daysOfWeek[now.getDay()];
  let dateNum = now.getDate();
  let month = months[now.getMonth()];
  let yearNum = now.getFullYear();

  if (timezone) {
    try {
      const options = {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      };
      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(now);
      const getPart = (type) => parts.find(p => p.type === type).value;

      dayOfWeek = getPart('weekday');
      dateNum = parseInt(getPart('day'), 10);
      month = getPart('month');
      yearNum = parseInt(getPart('year'), 10);
    } catch (e) {
      console.error(`Invalid timezone '${timezone}', falling back to server time.`);
    }
  }

  return {
    dayOfWeek,
    date: dateNum,
    month,
    year: yearNum
  };
};
