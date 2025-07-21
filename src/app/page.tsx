'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    // 自动重定向到embed页面
    router.push('/embed');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">AI 助残系统</h1>
        <p className="text-gray-600">正在跳转到应用界面...</p>
      </div>
    </div>
  );
} 