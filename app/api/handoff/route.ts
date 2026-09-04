import { NextResponse } from 'next/server';
export async function GET(){ return NextResponse.json({ handoff:null }); }
export async function POST(request: Request){ const body = await request.json(); return NextResponse.json({ ok:true, received:body, note:'TODO: persist in project_handoff' }); }
