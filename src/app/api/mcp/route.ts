import { NextRequest, NextResponse } from 'next/server';
import { mcpManager } from '@/utils/mcpConnector';

export async function POST(req: NextRequest) {
  try {
    const { name, url, apiKey } = await req.json();
    if (!name || !url) {
      return NextResponse.json({ error: 'name and url required' }, { status: 400 });
    }
    await mcpManager.registerConnector({ name, url, apiKey });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'connector error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ services: mcpManager.listServices() });
}
