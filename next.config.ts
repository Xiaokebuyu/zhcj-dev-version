import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // 🔧 配置静态资源前缀，确保在iframe中正确加载
  assetPrefix: '/web-assistant',
  
  // 🔧 配置路由重写，处理不同部署环境下的API路径
  async rewrites() {
    return [
      // 当通过 /web-assistant 访问时，API调用会自动处理正确的路径
      // 这样组件内的 fetch('/api/chat') 会自动工作，无需修改代码
    ];
  },
  
  eslint: {
    // 启用构建时ESLint检查
    ignoreDuringBuilds: false,
  },
  typescript: {
    // 启用构建时TypeScript检查
    ignoreBuildErrors: false,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'src'),
    };
    return config;
  },
};

export default nextConfig;
