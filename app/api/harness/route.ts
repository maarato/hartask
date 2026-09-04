import { NextResponse } from 'next/server';
export async function GET(){ return NextResponse.json({ components:[], note:'TODO: scan AGENTS.md, CLAUDE.md, .agents, .claude, .cursor, hooks and MCP config' }); }
