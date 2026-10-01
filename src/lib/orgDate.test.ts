   import { it, expect } from 'vitest';
   import { toOrgLocalIsoDate } from './orgDate';

   it('uses the org time zone, not UTC', () => {
     const d = new Date('2026-10-15T22:30:00Z');
     expect(toOrgLocalIsoDate(d, 'UTC')).toBe('2026-10-15');
     expect(toOrgLocalIsoDate(d, 'Asia/Karachi')).toBe('2026-10-16');
   });
