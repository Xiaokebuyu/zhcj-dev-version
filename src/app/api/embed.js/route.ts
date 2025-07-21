import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // 读取embed.js文件
    const embedPath = join(process.cwd(), 'public', 'embed.js');
    const embedContent = readFileSync(embedPath, 'utf-8');
    
    // 返回JavaScript文件，设置正确的Content-Type
    return new NextResponse(embedContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600', // 缓存1小时
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Error serving embed.js:', error);
    return new NextResponse('embed.js not found', { status: 404 });
  }
} 