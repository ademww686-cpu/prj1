import test from 'node:test';
import assert from 'node:assert/strict';
import {algiersDateOffset,validDateTime} from '../server/src/booking-time.js';

test('validates any clock time without depending on the server timezone',()=>{
  const previous=process.env.TZ;
  try{
    for(const timezone of ['UTC','Africa/Algiers','Pacific/Apia']){
      process.env.TZ=timezone;
      for(const time of ['00:30','12:00','23:59'])assert.equal(validDateTime('2027-06-15',time),true,`${timezone} ${time}`);
      assert.equal(validDateTime('2026-02-30','12:00'),false);
      assert.equal(validDateTime('2027-06-15','24:00'),false);
    }
  }finally{
    if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;
  }
});

test('checks calendar dates including leap years',()=>{
  assert.equal(validDateTime('2028-02-29','00:00'),true);
  assert.equal(validDateTime('2027-02-29','00:00'),false);
  assert.equal(validDateTime('2027-13-01','12:00'),false);
  assert.equal(validDateTime('0000-01-01','12:00'),false);
});

test('computes the date in Africa/Algiers independently of machine timezone',()=>{
  const now=new Date('2026-06-05T23:30:00.000Z');
  assert.equal(algiersDateOffset(0,now),'2026-06-06');
  assert.equal(algiersDateOffset(365,now),'2027-06-06');
});
