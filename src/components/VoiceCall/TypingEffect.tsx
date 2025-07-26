'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TypingEffectProps } from '@/types';

/**
 * 打字机效果组件
 * 用于实时转录文字的逐字显示，带有光标闪烁动画
 */
export function TypingEffect({ 
  text, 
  speed = 50, 
  onComplete, 
  cursor = true, 
  className = '' 
}: TypingEffectProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const previousTextRef = useRef('');

  // 清理定时器
  const clearTypingInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // 重置打字机状态
  const resetTyping = useCallback(() => {
    clearTypingInterval();
    setDisplayedText('');
    setCurrentIndex(0);
    setIsCompleted(false);
  }, [clearTypingInterval]);

  // 开始打字机效果
  const startTyping = useCallback(() => {
    clearTypingInterval();
    
    if (!text || currentIndex >= text.length) {
      if (!isCompleted && text) {
        setIsCompleted(true);
        onComplete?.();
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setCurrentIndex(prevIndex => {
        const nextIndex = prevIndex + 1;
        
        if (nextIndex >= text.length) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setIsCompleted(true);
          onComplete?.();
          return nextIndex;
        }
        
        return nextIndex;
      });
    }, speed);
  }, [text, currentIndex, speed, onComplete, isCompleted, clearTypingInterval]);

  // 监听文本变化
  useEffect(() => {
    const currentText = text || '';
    const previousText = previousTextRef.current;
    
    // 如果文本完全不同，重新开始打字
    if (currentText !== previousText) {
      if (currentText.length === 0) {
        // 清空文本
        resetTyping();
      } else if (!currentText.startsWith(previousText)) {
        // 完全不同的文本，重新开始
        resetTyping();
        previousTextRef.current = currentText;
        setCurrentIndex(0);
      } else {
        // 文本是在原有基础上追加的，继续打字
        previousTextRef.current = currentText;
        if (currentIndex < currentText.length && !isCompleted) {
          startTyping();
        }
      }
    }
  }, [text, resetTyping, startTyping, currentIndex, isCompleted]);

  // 更新显示的文本
  useEffect(() => {
    if (text) {
      const newDisplayedText = text.slice(0, currentIndex);
      setDisplayedText(newDisplayedText);
    }
  }, [text, currentIndex]);

  // 开始打字动画
  useEffect(() => {
    if (text && currentIndex < text.length && !isCompleted) {
      startTyping();
    }
    
    return () => {
      clearTypingInterval();
    };
  }, [text, currentIndex, isCompleted, startTyping, clearTypingInterval]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearTypingInterval();
    };
  }, [clearTypingInterval]);

  return (
    <div className={`relative ${className}`}>
      <div className="min-h-[24px] leading-relaxed">
        {/* 显示的文本 */}
        <span className="break-words whitespace-pre-wrap">
          {displayedText}
        </span>
        
        {/* 光标 */}
        {cursor && !isCompleted && (
          <span className="animate-pulse inline-block w-0.5 h-5 bg-current ml-0.5 align-text-bottom">
            |
          </span>
        )}
        
        {/* 完成后的静态光标 */}
        {cursor && isCompleted && displayedText && (
          <span className="inline-block w-0.5 h-5 bg-current ml-0.5 align-text-bottom opacity-30">
            |
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 实时转录显示组件
 * 专门用于语音通话模式的实时转录显示
 */
interface RealtimeTranscriptProps {
  transcript: string;
  isActive: boolean;
  className?: string;
}

export function RealtimeTranscript({ 
  transcript, 
  isActive, 
  className = '' 
}: RealtimeTranscriptProps) {
  const [lastTranscript, setLastTranscript] = useState('');
  const [isTypingComplete, setIsTypingComplete] = useState(false);

  // 监听转录文本变化
  useEffect(() => {
    if (transcript !== lastTranscript) {
      setLastTranscript(transcript);
      setIsTypingComplete(false);
    }
  }, [transcript, lastTranscript]);

  const handleTypingComplete = useCallback(() => {
    setIsTypingComplete(true);
  }, []);

  if (!isActive) {
    return null;
  }

  return (
    <div className={`
      p-4 rounded-xl transition-all duration-300
      ${transcript 
        ? 'bg-blue-50 border border-blue-200' 
        : 'bg-gray-50 border border-gray-200'
      }
      ${className}
    `}>
      {/* 状态指示器 */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`
          w-2 h-2 rounded-full transition-colors duration-300
          ${isActive && transcript ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}
        `} />
        <span className="text-sm font-medium text-gray-600">
          {transcript ? '实时转录' : '等待语音输入...'}
        </span>
      </div>

      {/* 转录文本显示区域 */}
      <div className="min-h-[60px] flex items-center">
        {transcript ? (
          <TypingEffect
            text={transcript}
            speed={30} // 稍快的打字速度用于实时感
            onComplete={handleTypingComplete}
            cursor={true}
            className="text-gray-800 text-base leading-relaxed"
          />
        ) : (
          <div className="text-gray-400 italic text-base">
            请开始说话，我会实时显示您的语音内容...
          </div>
        )}
      </div>

      {/* 完成状态提示 */}
      {isTypingComplete && transcript && (
        <div className="mt-2 pt-2 border-t border-blue-200">
          <div className="text-xs text-blue-600 flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>转录完成</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 语音状态指示器组件
 */
interface VoiceStatusIndicatorProps {
  isListening: boolean;
  volume?: number;
  className?: string;
}

export function VoiceStatusIndicator({ 
  isListening, 
  volume = 0, 
  className = '' 
}: VoiceStatusIndicatorProps) {
  // 根据音量生成波形显示
  const generateWaveform = () => {
    const bars = 8;
    const heights = [];
    
    for (let i = 0; i < bars; i++) {
      if (isListening) {
        // 模拟音频波形，中间的柱子更高
        const centerDistance = Math.abs(i - bars / 2);
        const baseHeight = 20 + (volume * 60) * (1 - centerDistance / (bars / 2));
        const randomVariation = Math.random() * 20;
        heights.push(Math.min(80, Math.max(10, baseHeight + randomVariation)));
      } else {
        heights.push(10); // 静音时的最小高度
      }
    }
    
    return heights;
  };

  const waveformHeights = generateWaveform();

  return (
    <div className={`flex items-end justify-center gap-1 h-20 ${className}`}>
      {waveformHeights.map((height, index) => (
        <div
          key={index}
          className={`
            w-1 rounded-full transition-all duration-150 ease-out
            ${isListening 
              ? 'bg-gradient-to-t from-blue-500 to-blue-300' 
              : 'bg-gray-300'
            }
          `}
          style={{ 
            height: `${height}%`,
            animationDelay: `${index * 50}ms`,
            animation: isListening ? 'pulse 1s ease-in-out infinite alternate' : 'none'
          }}
        />
      ))}
    </div>
  );
}