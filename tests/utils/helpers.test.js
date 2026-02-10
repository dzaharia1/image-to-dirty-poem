import { jest } from '@jest/globals';
import { formatDate } from '../../utils/helpers.js';

describe('formatDate', () => {
  beforeAll(() => {
    // Set system time to 2023-10-27T12:00:00Z (Friday)
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2023-10-27T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('should return correct date structure for default call', () => {
    const result = formatDate();
    expect(result).toHaveProperty('dayOfWeek');
    expect(result).toHaveProperty('date');
    expect(result).toHaveProperty('month');
    expect(result).toHaveProperty('year');
    expect(typeof result.dayOfWeek).toBe('string');
    expect(typeof result.date).toBe('number');
    expect(typeof result.month).toBe('string');
    expect(typeof result.year).toBe('number');
  });

  test('should return correct date for a specific timezone (New York)', () => {
    // 2023-10-27T12:00:00Z is 2023-10-27 08:00:00 in New York (Friday)
    const result = formatDate('America/New_York');
    expect(result.dayOfWeek).toBe('Friday');
    expect(result.date).toBe(27);
    expect(result.month).toBe('October');
    expect(result.year).toBe(2023);
  });

  test('should return correct date for a specific timezone (Tokyo)', () => {
    // 2023-10-27T12:00:00Z is 2023-10-27 21:00:00 in Tokyo (Friday)
    const result = formatDate('Asia/Tokyo');
    expect(result.dayOfWeek).toBe('Friday');
    expect(result.date).toBe(27);
    expect(result.month).toBe('October');
    expect(result.year).toBe(2023);
  });

  test('should handle invalid timezone gracefully', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = formatDate('Invalid/Timezone');

    // It should fallback to system time (which is mocked to UTC effectively here, or whatever system timezone is)
    // The key is that it shouldn't throw and should return a valid object
    expect(result).toHaveProperty('dayOfWeek');
    expect(result).toHaveProperty('date');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
