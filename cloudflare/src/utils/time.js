import {MANILA_TIME_ZONE} from '../constants.js';

export function utcDay(now=new Date()){return now.toISOString().slice(0,10);}

export function manilaDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:MANILA_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
  const [year,month,day]=value.split('-').map(Number), parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;
}

export function validTime(value){
  if(!/^\d{2}:\d{2}$/.test(value||''))return false;
  const [hour,minute]=value.split(':').map(Number);return hour<24&&minute<60;
}

export function addDays(date,days){
  const parsed=new Date(`${date}T00:00:00Z`);parsed.setUTCDate(parsed.getUTCDate()+days);return parsed.toISOString().slice(0,10);
}

export function phtTimestamp(date,time){
  if(!validDate(date)||!validTime(time))return null;
  return `${date}T${time}:00+08:00`;
}

export function eventWindow(date,start,end){
  const startAt=phtTimestamp(date,start);if(!startAt)return {startAt:null,endAt:null,overnight:false};
  if(end==null)return {startAt,endAt:null,overnight:false};
  if(!validTime(end))return {startAt,endAt:null,overnight:false,invalidEnd:true};
  const overnight=end<=start, endDate=overnight?addDays(date,1):date;
  return {startAt,endAt:phtTimestamp(endDate,end),overnight};
}
