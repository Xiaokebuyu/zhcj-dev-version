'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Pause, Play } from 'lucide-react';
import { RealtimeTranscript, VoiceStatusIndicator } from './TypingEffect';
import { VoiceCallState } from '@/types';

interface VoiceCallModeProps {
  voiceCallState: VoiceCallState;
  onStartCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  className?: string;
}

/**
 * 语音通话模式组件
 * 提供语音通话的完整UI界面，复用现有的会话框区域
 */
export function VoiceCallMode({
  voiceCallState,
  onStartCall,
  onEndCall,
  onToggleMute,
  onTogglePause,
  className = ''
}: VoiceCallModeProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentVolume] = useState(0);
  const [callDurationDisplay, setCallDurationDisplay] = useState('00:00');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 格式化通话时长
  const formatDuration = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // 更新通话时长显示
  useEffect(() => {
    if (voiceCallState.isCallActive && voiceCallState.connectionStatus === 'connected') {
      timerRef.current = setInterval(() => {
        const duration = Math.floor(voiceCallState.callDuration / 1000);
        setCallDurationDisplay(formatDuration(duration));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [voiceCallState.isCallActive, voiceCallState.connectionStatus, voiceCallState.callDuration, formatDuration]);

  // 处理静音切换
  const handleToggleMute = useCallback(() => {
    setIsMuted(!isMuted);
    onToggleMute();
  }, [isMuted, onToggleMute]);

  // 处理暂停切换
  const handleTogglePause = useCallback(() => {
    setIsPaused(!isPaused);
    onTogglePause();
  }, [isPaused, onTogglePause]);

  // 获取连接状态显示文本
  const getConnectionStatusText = (): string => {
    switch (voiceCallState.connectionStatus) {
      case 'connecting':
        return '正在连接豆包语音服务...';
      case 'connected':
        return '通话中';
      case 'disconnected':
        return '通话已结束';
      case 'error':
        return '连接失败，请重试';
      default:
        return '点击开始语音通话';
    }
  };

  // 获取连接状态颜色
  const getConnectionStatusColor = (): string => {
    switch (voiceCallState.connectionStatus) {
      case 'connecting':
        return 'text-blue-600';
      case 'connected':
        return 'text-green-600';
      case 'disconnected':
        return 'text-gray-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  // 渲染等待状态
  const renderIdleState = () => (
    <div className="flex flex-col items-center justify-center h-full py-8">
      <div className="w-20 h-20 bg-gradient-to-r from-orange-100 to-amber-100 rounded-2xl flex items-center justify-center mb-6">
        <Phone size={32} className="text-orange-500" strokeWidth={2} />
      </div>
      
      <h3 className="text-lg font-semibold text-gray-800 mb-2">豆包语音通话</h3>
      <p className="text-gray-600 text-sm text-center mb-6 leading-relaxed">
        与豆包AI进行实时语音对话<br />
        支持实时转录和智能回复
      </p>
      
      <button
        onClick={onStartCall}
        className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-6 py-3 rounded-2xl transition-all duration-200 flex items-center gap-2 shadow-lg shadow-green-200/50 hover:shadow-green-300/50"
      >
        <Phone size={20} strokeWidth={2} />
        <span>开始通话</span>
      </button>
    </div>
  );

  // 渲染连接中状态
  const renderConnectingState = () => (
    <div className="flex flex-col items-center justify-center h-full py-8">
      <div className="w-20 h-20 bg-gradient-to-r from-blue-100 to-blue-200 rounded-2xl flex items-center justify-center mb-6">
        <div className="animate-spin rounded-full h-8 w-8 border-3 border-blue-500 border-t-transparent"></div>
      </div>
      
      <h3 className="text-lg font-semibold text-gray-800 mb-2">正在连接</h3>
      <p className="text-gray-600 text-sm text-center mb-6">
        正在建立与豆包语音服务的连接...
      </p>
      
      <button
        onClick={onEndCall}
        className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-xl transition-colors duration-200"
      >
        取消连接
      </button>
    </div>
  );

  // 渲染通话中状态
  const renderActiveCallState = () => (
    <div className="flex flex-col h-full">
      {/* 通话状态信息 */}
      <div className="text-center py-4 border-b border-gray-100">
        <div className={`text-sm font-medium ${getConnectionStatusColor()}`}>
          {getConnectionStatusText()}
        </div>
        {voiceCallState.isCallActive && (
          <div className="text-lg font-mono text-gray-700 mt-1">
            {callDurationDisplay}
          </div>
        )}
      </div>

      {/* 实时转录显示区域 - 复用现有会话框的空间 */}
      <div className="flex-1 p-4 overflow-y-auto">
        <RealtimeTranscript
          transcript={voiceCallState.realtimeTranscript}
          isActive={voiceCallState.isCallActive}
          className="mb-4"
        />
      </div>

      {/* 音频可视化 */}
      <div className="px-4 py-2">
        <VoiceStatusIndicator
          isListening={voiceCallState.isCallActive && !isMuted}
          volume={currentVolume}
          className="mb-4"
        />
      </div>

      {/* 通话控制按钮 */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex justify-center gap-4">
          {/* 静音按钮 */}
          <button
            onClick={handleToggleMute}
            className={`
              p-3 rounded-2xl transition-all duration-200 shadow-lg
              ${isMuted 
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-200/50' 
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700 shadow-gray-200/50'
              }
            `}
            title={isMuted ? '取消静音' : '静音'}
          >
            {isMuted ? <MicOff size={20} strokeWidth={2} /> : <Mic size={20} strokeWidth={2} />}
          </button>

          {/* 暂停按钮 */}
          <button
            onClick={handleTogglePause}
            className={`
              p-3 rounded-2xl transition-all duration-200 shadow-lg
              ${isPaused 
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white shadow-yellow-200/50' 
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700 shadow-gray-200/50'
              }
            `}
            title={isPaused ? '继续通话' : '暂停通话'}
          >
            {isPaused ? <Play size={20} strokeWidth={2} /> : <Pause size={20} strokeWidth={2} />}
          </button>

          {/* 挂断按钮 */}
          <button
            onClick={onEndCall}
            className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white p-3 rounded-2xl transition-all duration-200 shadow-lg shadow-red-200/50 hover:shadow-red-300/50"
            title="结束通话"
          >
            <PhoneOff size={20} strokeWidth={2} />
          </button>
        </div>

        {/* 通话提示信息 */}
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            {isMuted && '🔇 麦克风已静音'}
            {isPaused && '⏸️ 通话已暂停'}
            {!isMuted && !isPaused && voiceCallState.isCallActive && '🎙️ 正在监听您的语音...'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            手动点击挂断按钮结束通话
          </p>
        </div>
      </div>
    </div>
  );

  // 渲染错误状态
  const renderErrorState = () => (
    <div className="flex flex-col items-center justify-center h-full py-8">
      <div className="w-20 h-20 bg-gradient-to-r from-red-100 to-red-200 rounded-2xl flex items-center justify-center mb-6">
        <PhoneOff size={32} className="text-red-500" strokeWidth={2} />
      </div>
      
      <h3 className="text-lg font-semibold text-gray-800 mb-2">连接失败</h3>
      <p className="text-gray-600 text-sm text-center mb-6">
        无法连接到豆包语音服务<br />
        请检查网络连接后重试
      </p>
      
      <div className="flex gap-3">
        <button
          onClick={onStartCall}
          className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-4 py-2 rounded-xl transition-all duration-200"
        >
          重试连接
        </button>
        <button
          onClick={onEndCall}
          className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-xl transition-colors duration-200"
        >
          取消
        </button>
      </div>
    </div>
  );

  // 根据状态渲染对应界面
  const renderContent = () => {
    switch (voiceCallState.connectionStatus) {
      case 'idle':
        return renderIdleState();
      case 'connecting':
        return renderConnectingState();
      case 'connected':
        return renderActiveCallState();
      case 'error':
        return renderErrorState();
      case 'disconnected':
        return renderIdleState();
      default:
        return renderIdleState();
    }
  };

  return (
    <div className={`h-full flex flex-col ${className}`}>
      {renderContent()}
    </div>
  );
}

/**
 * 语音通话设置面板组件
 */
interface VoiceCallSettingsProps {
  audioQuality: 'low' | 'medium' | 'high';
  silenceDetection: boolean;
  onAudioQualityChange: (quality: 'low' | 'medium' | 'high') => void;
  onSilenceDetectionChange: (enabled: boolean) => void;
  className?: string;
}

export function VoiceCallSettings({
  audioQuality,
  silenceDetection,
  onAudioQualityChange,
  onSilenceDetectionChange,
  className = ''
}: VoiceCallSettingsProps) {
  return (
    <div className={`p-4 space-y-4 ${className}`}>
      <h3 className="font-medium text-gray-900">语音通话设置</h3>
      
      {/* 音频质量设置 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          音频质量
        </label>
        <select
          value={audioQuality}
          onChange={(e) => onAudioQualityChange(e.target.value as 'low' | 'medium' | 'high')}
          className="w-full p-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="low">低质量（省流量）</option>
          <option value="medium">中等质量（推荐）</option>
          <option value="high">高质量（最佳体验）</option>
        </select>
      </div>

      {/* 静音检测设置 */}
      <div className="flex items-center space-x-3">
        <input
          type="checkbox"
          id="silenceDetection"
          checked={silenceDetection}
          onChange={(e) => onSilenceDetectionChange(e.target.checked)}
          className="rounded border-gray-300"
        />
        <label htmlFor="silenceDetection" className="text-sm text-gray-700">
          启用智能静音检测（8秒无声自动挂断）
        </label>
      </div>

      {/* 使用提示 */}
      <div className="mt-4 p-3 bg-blue-50 rounded-lg">
        <h4 className="text-sm font-medium text-blue-800 mb-1">使用提示</h4>
        <ul className="text-xs text-blue-700 space-y-1">
          <li>• 开始通话前请确保麦克风权限已开启</li>
          <li>• 建议在安静环境下使用以获得最佳体验</li>
          <li>• 通话过程中的转录内容会实时显示</li>
          <li>• 支持静音、暂停等通话控制功能</li>
        </ul>
      </div>
    </div>
  );
}