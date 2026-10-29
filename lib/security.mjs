import {randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function safeEqual(a,b) { const left=Buffer.from(String(a)),right=Buffer.from(String(b)); return left.length===right.length&&timingSafeEqual(left,right); }
export async function passwordHash(password) { const salt=randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`; }
export async function verifyPassword(password,stored) { const [salt,key]=stored.split(':'); const result=await scrypt(password,salt,64); return safeEqual(result.toString('hex'),key); }
export class AppError extends Error { constructor(status,message){super(message);this.status=status;} }
export function requireText(value,label,max=100,min=1) { if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new AppError(422,`${label}을(를) ${min}~${max}자로 입력해 주세요.`);return value.trim(); }
export function validateUsername(value) { if(typeof value!=='string'||!/^[a-zA-Z0-9_.-]{3,40}$/.test(value))throw new AppError(422,'아이디는 영문, 숫자, _, ., - 조합 3~40자로 입력해 주세요.');return value.toLowerCase(); }
export function validatePassword(value) { if(typeof value!=='string'||value.length<10||value.length>128)throw new AppError(422,'비밀번호는 10~128자로 입력해 주세요.');return value; }
export async function jsonBody(req) { const type=req.headers['content-type']?.split(';')[0].trim(); if(type!=='application/json')throw new AppError(415,'JSON 형식으로 요청해 주세요.'); let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>16_384)throw new AppError(413,'요청 내용이 너무 큽니다.');parts.push(chunk);}try{const value=JSON.parse(Buffer.concat(parts).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new AppError(400,'올바른 요청 내용이 아닙니다.');} }
