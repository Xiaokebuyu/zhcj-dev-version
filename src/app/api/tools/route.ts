// src/app/api/tools/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ToolCall, ToolResult, PageContext } from '@/types';
import { ExtendedToolExecutor } from '@/utils/toolManagerExtended';

export async function POST(request: NextRequest) {
  try {
    const { tool_calls, pageContext }: { tool_calls: ToolCall[], pageContext?: PageContext } = await request.json();

    if (!tool_calls || !Array.isArray(tool_calls) || tool_calls.length === 0) {
      return NextResponse.json(
        { error: '无效的工具调用格式' },
        { status: 400 }
      );
    }

    // ✅ 关键修复：从浏览器请求中提取认证信息
    const extractAuthFromRequest = (req: NextRequest): string | null => {
      // 方法1：从Cookie Header中提取
      const cookieHeader = req.headers.get('cookie');
      if (cookieHeader) {
        const cookies = cookieHeader.split('; ').reduce((acc, cookie) => {
          const [key, value] = cookie.split('=');
          acc[key] = value;
          return acc;
        }, {} as Record<string, string>);
        
        // 优先使用ada_token
        if (cookies.ada_token) {
          console.log('🔑 从请求Cookie中提取ada_token成功');
          return cookies.ada_token;
        }
        
        // 回退到satoken
        if (cookies.satoken) {
          console.log('🔑 从请求Cookie中提取satoken成功');
          return cookies.satoken;
        }
      }
      
      // 方法2：从Authorization头中提取
      const authHeader = req.headers.get('authorization');
      if (authHeader) {
        console.log('🔑 从Authorization头中提取认证信息');
        return authHeader.replace('Bearer ', '');
      }
      
      return null;
    };

    // ✅ 提取服务端认证信息
    const serverAuthToken = extractAuthFromRequest(request);
    
    // ✅ 创建增强的pageContext，包含服务端认证信息
    const enhancedPageContext: PageContext | undefined = pageContext ? {
      ...pageContext,
      auth: {
        satoken: serverAuthToken || pageContext?.auth?.satoken
      }
    } : serverAuthToken ? {
      auth: {
        satoken: serverAuthToken
      },
      basic: {
        title: 'Unknown',
        url: request.headers.get('referer') || 'Unknown',
        type: 'page'
      }
    } : undefined;

    console.log('🔍 API路由认证信息:', {
      hasServerToken: !!serverAuthToken,
      hasClientToken: !!pageContext?.auth?.satoken,
      tokenSource: serverAuthToken ? 'server_request' : 'client_pageContext'
    });

    // ✅ 使用增强的pageContext调用扩展工具执行器（包含MCP支持）
    const results: ToolResult[] = await ExtendedToolExecutor.executeTools(tool_calls, enhancedPageContext);

    return NextResponse.json({
      results,
      success: true
    });

  } catch (error) {
    console.error('工具API错误:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : '服务器内部错误',
        success: false 
      },
      { status: 500 }
    );
  }
}

// 天气工具执行函数
async function executeWeatherTool(argumentsStr: string) {
  const args = JSON.parse(argumentsStr);
  const { location, adm } = args;
  
  const QWEATHER_TOKEN = process.env.QWEATHER_API_KEY;
  
  if (!QWEATHER_TOKEN) {
    throw new Error('和风天气API密钥未配置');
  }
  
  // 第一步：获取地理位置信息
  const geoData = await getGeoLocation(location, adm, QWEATHER_TOKEN);
  if (!geoData || geoData.length === 0) {
    throw new Error(`未找到城市: ${location}`);
  }
  
  const cityInfo = geoData[0]; // 取第一个结果
  const { lat, lon, name, adm1, adm2 } = cityInfo;
  
  // 并行请求多个天气API
  const [weatherNow, airQuality, weatherIndices, minutely] = await Promise.allSettled([
    getWeatherNow(lat, lon, QWEATHER_TOKEN),
    getAirQuality(lat, lon, QWEATHER_TOKEN),
    getWeatherIndices(lat, lon, QWEATHER_TOKEN),
    getMinutelyPrecipitation(lat, lon, QWEATHER_TOKEN)
  ]);
  
  // 处理结果
  const result = {
    success: true,
    location: {
      name,
      adm1,
      adm2,
      lat,
      lon
    },
    weather: weatherNow.status === 'fulfilled' ? weatherNow.value : null,
    airQuality: airQuality.status === 'fulfilled' ? airQuality.value : null,
    indices: weatherIndices.status === 'fulfilled' ? weatherIndices.value : null,
    minutely: minutely.status === 'fulfilled' ? minutely.value : null,
    timestamp: new Date().toISOString(),
    errors: [
      weatherNow.status === 'rejected' ? `天气数据: ${weatherNow.reason}` : null,
      airQuality.status === 'rejected' ? `空气质量: ${airQuality.reason}` : null,
      weatherIndices.status === 'rejected' ? `天气指数: ${weatherIndices.reason}` : null,
      minutely.status === 'rejected' ? `分钟降水: ${minutely.reason}` : null,
    ].filter(Boolean)
  };
  
  return result;
}

// 地理位置查询
async function getGeoLocation(location: string, adm: string | undefined, token: string) {
  const params = new URLSearchParams({
    location,
    key: token
  });
  
  if (adm) {
    params.append('adm', adm);
  }
  
  const response = await fetch(`https://geoapi.qweather.com/v2/city/lookup?${params}`);
  
  if (!response.ok) {
    throw new Error(`地理位置API请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.code !== '200') {
    throw new Error(`地理位置查询失败: ${data.code}`);
  }
  
  return data.location || [];
}

// 实时天气
async function getWeatherNow(lat: string, lon: string, token: string) {
  const response = await fetch(
    `https://devapi.qweather.com/v7/weather/now?location=${lon},${lat}&key=${token}`
  );
  
  if (!response.ok) {
    throw new Error(`实时天气API请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.code !== '200') {
    throw new Error(`实时天气查询失败: ${data.code}`);
  }
  
  return data.now;
}

// 空气质量
async function getAirQuality(lat: string, lon: string, token: string) {
  const response = await fetch(
    `https://devapi.qweather.com/v7/air/now?location=${lon},${lat}&key=${token}`
  );
  
  if (!response.ok) {
    throw new Error(`空气质量API请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.code !== '200') {
    throw new Error(`空气质量查询失败: ${data.code}`);
  }
  
  return data.now;
}

// 天气指数
async function getWeatherIndices(lat: string, lon: string, token: string) {
  const response = await fetch(
    `https://devapi.qweather.com/v7/indices/1d?type=1,2,3,5,8&location=${lon},${lat}&key=${token}`
  );
  
  if (!response.ok) {
    throw new Error(`天气指数API请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.code !== '200') {
    throw new Error(`天气指数查询失败: ${data.code}`);
  }
  
  return data.daily || [];
}

// 分钟级降水
async function getMinutelyPrecipitation(lat: string, lon: string, token: string) {
  const response = await fetch(
    `https://devapi.qweather.com/v7/minutely/5m?location=${lon},${lat}&key=${token}`
  );
  
  if (!response.ok) {
    throw new Error(`分钟降水API请求失败: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.code !== '200') {
    throw new Error(`分钟降水查询失败: ${data.code}`);
  }
  
  return data;
}

// 网络搜索工具执行函数
async function executeWebSearchTool(argumentsStr: string) {
  const args = JSON.parse(argumentsStr);
  const { query, count = 8 } = args;
  
  const BOCHA_API_KEY = process.env.BOCHA_API_KEY;
  
  if (!BOCHA_API_KEY) {
    throw new Error('博查AI搜索API密钥未配置');
  }
  
  try {
    const response = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BOCHA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        freshness: "oneYear", // 优先最近一年
        summary: true,        // 返回长文本摘要
        count: Math.min(count, 8) // 最多8条结果
      })
    });

    if (!response.ok) {
      throw new Error(`搜索API请求失败: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.code !== 200) {
      throw new Error(`搜索失败: ${data.msg || '未知错误'}`);
    }

    // 提取搜索结果
    const searchResults = data.data?.webPages?.value || [];
    
    return {
      success: true,
      query,
      totalResults: data.data?.webPages?.totalEstimatedMatches || 0,
      results: searchResults.map((item: unknown) => {
        const webItem = item as Record<string, unknown>;
        return {
          name: (webItem.name as string) || '',
          url: (webItem.url as string) || '',
          snippet: (webItem.snippet as string) || '',
          summary: (webItem.summary as string) || (webItem.snippet as string) || '',
          siteName: (webItem.siteName as string) || '',
          datePublished: (webItem.datePublished as string) || (webItem.dateLastCrawled as string) || '',
          siteIcon: (webItem.siteIcon as string) || ''
        };
      }),
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('网络搜索失败:', error);
    throw new Error(`网络搜索失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

// 支持OPTIONS请求（CORS预检）
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// 健康检查
export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    service: 'Tools API',
    supportedTools: ['get_weather','web_search','openmanus_web_automation','openmanus_code_execution','openmanus_file_operations','openmanus_general_task'],
    timestamp: new Date().toISOString() 
  });
}