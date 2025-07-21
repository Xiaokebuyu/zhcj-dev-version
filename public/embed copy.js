(function(window, document) {
  'use strict';

  // 防止重复加载
  if (window.AIAssistant) {
    console.warn('AI Assistant 已经被加载过了');
    return;
  }

  // 默认配置
  const DEFAULT_CONFIG = {
    baseUrl: window.location.protocol + '//' + window.location.host,
    position: 'bottom-right',
    theme: 'light',
    enableVoice: true,
    maxMessages: 50,
    // 新增：页面感知配置
    enablePageContext: true,
    contextDepth: 'medium', // 'light', 'medium', 'full'
    autoUpdateContext: true, // 页面变化时自动更新上下文
    contextUpdateInterval: 30000 // 改为30秒，避免过于频繁
  };

  // 页面内容提取器
  class PageContextExtractor {
    constructor(config = {}) {
      this.config = config;
      this.lastHash = '';
      this.lastTitle = '';
      this.observer = null;
    }

    // 提取页面基本信息
    extractBasicInfo() {
      return {
        url: window.location.href,
        title: document.title,
        domain: window.location.hostname,
        pathname: window.location.pathname,
        timestamp: new Date().toISOString()
      };
    }

    // 提取页面主要内容
    extractPageContent(depth = 'medium') {
      const content = {
        basic: this.extractBasicInfo(),
        meta: this.extractMetaData(),
        headings: this.extractHeadings(),
        mainContent: this.extractMainContent(depth),
        navigation: this.extractNavigation(),
        pageType: this.detectPageType(),
        // 🆕 方案A：添加认证信息提取
        authInfo: this.extractAuthInfo()
      };

      // ✅ 添加正确的认证信息映射到AI助手期望的格式
      const ada_token = this.extractAdaToken();
      if (ada_token) {
        content.auth = {
          satoken: ada_token
        };
        console.log('🔑 embed.js: 成功映射ada_token到auth.satoken');
      } else {
        console.warn('⚠️ embed.js: 未找到ada_token');
      }

      return content;
    }

    // 🆕 提取认证相关信息
    extractAuthInfo() {
      const authInfo = {
        cookies: document.cookie,
        timestamp: Date.now()
      };

      // 提取localStorage中的认证信息
      const authKeys = ['token', 'satoken', 'auth', 'user', 'session', 'ada_token'];
      const localStorage_auth = {};
      
      try {
        authKeys.forEach(key => {
          const value = localStorage.getItem(key);
          if (value) {
            localStorage_auth[key] = value;
          }
          
          // 也检查包含这些关键词的其他key
          Object.keys(localStorage).forEach(storageKey => {
            if (storageKey.toLowerCase().includes(key.toLowerCase()) && !localStorage_auth[storageKey]) {
              localStorage_auth[storageKey] = localStorage.getItem(storageKey);
            }
          });
        });
        
        authInfo.localStorage = localStorage_auth;
      } catch (e) {
        console.warn('无法访问localStorage:', e);
        authInfo.localStorage = {};
      }

      // 提取sessionStorage中的认证信息
      try {
        const sessionStorage_auth = {};
        authKeys.forEach(key => {
          const value = sessionStorage.getItem(key);
          if (value) {
            sessionStorage_auth[key] = value;
          }
        });
        authInfo.sessionStorage = sessionStorage_auth;
      } catch (e) {
        console.warn('无法访问sessionStorage:', e);
        authInfo.sessionStorage = {};
      }

      return authInfo;
    }

    // ✅ 添加专门的ada_token提取方法
    extractAdaToken() {
      try {
        // 方法1：从Cookie提取
        const cookieToken = document.cookie
          .split('; ')
          .find(cookie => cookie.startsWith('ada_token='))
          ?.split('=')[1];
        
        if (cookieToken) {
          console.log('🔑 embed.js: 从Cookie成功提取ada_token');
          return cookieToken;
        }

        // 方法2：从localStorage提取
        const localToken = localStorage.getItem('ada_token');
        if (localToken) {
          console.log('🔑 embed.js: 从localStorage成功提取ada_token');
          return localToken;
        }

        // 方法3：检查是否有其他相关token
        const allCookies = document.cookie.split('; ');
        for (const cookie of allCookies) {
          if (cookie.includes('token') && !cookie.includes('csrf')) {
            const [key, value] = cookie.split('=');
            if (key.toLowerCase().includes('ada') || key.toLowerCase().includes('auth')) {
              console.log(`🔑 embed.js: 从Cookie找到相关token: ${key}`);
              return value;
            }
          }
        }

        console.warn('⚠️ embed.js: 未找到ada_token');
        return null;
      } catch (error) {
        console.warn('❌ embed.js: 提取ada_token失败:', error);
        return null;
      }
    }

    // 提取meta信息
    extractMetaData() {
      const metaData = {};
      
      // 基本meta标签
      const metaTags = document.querySelectorAll('meta[name], meta[property]');
      metaTags.forEach(tag => {
        const name = tag.getAttribute('name') || tag.getAttribute('property');
        const content = tag.getAttribute('content');
        if (name && content) {
          metaData[name] = content;
        }
      });

      return metaData;
    }

    // 提取标题结构
    extractHeadings() {
      const headings = [];
      const headingTags = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      
      headingTags.forEach(heading => {
        headings.push({
          level: parseInt(heading.tagName.substring(1)),
          text: heading.textContent.trim(),
          id: heading.id || null
        });
      });

      return headings;
    }

    // 提取主要内容
    extractMainContent(depth) {
      const content = {
        summary: '',
        sections: [],
        keyElements: []
      };

      try {
        // 提取主要文本内容
        const mainSelectors = ['main', 'article', '.content', '.main-content', '#content', '#main'];
        let mainElement = null;
        
        for (const selector of mainSelectors) {
          mainElement = document.querySelector(selector);
          if (mainElement) break;
        }
        
        const targetElement = mainElement || document.body;
        
        // 清理文本
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = targetElement.innerHTML;
        
        // 移除不需要的元素
        const unwantedElements = tempDiv.querySelectorAll('script, style, nav, footer, .sidebar, .ad, [data-ad]');
        unwantedElements.forEach(el => el.remove());
        
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        content.summary = textContent
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, depth === 'light' ? 1000 : depth === 'medium' ? 3000 : 5000);
          
      } catch (error) {
        console.warn('内容提取失败:', error);
        content.summary = document.title || '';
      }

      return content;
    }

    // 提取导航信息
    extractNavigation() {
      const navigation = {
        menuItems: [],
        breadcrumbs: []
      };

      try {
        // 提取主导航
        const navElements = document.querySelectorAll('nav a, .nav a, .menu a');
        navElements.forEach(link => {
          if (link.textContent.trim()) {
            navigation.menuItems.push({
              text: link.textContent.trim(),
              href: link.href
            });
          }
        });

        // 提取面包屑
        const breadcrumbSelectors = ['.breadcrumb a', '.breadcrumbs a', '[data-breadcrumb] a'];
        breadcrumbSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(link => {
            if (link.textContent.trim()) {
              navigation.breadcrumbs.push({
                text: link.textContent.trim(),
                href: link.href
              });
            }
          });
        });
        
      } catch (error) {
        console.warn('导航提取失败:', error);
      }

      return navigation;
    }

    // 检测页面类型
    detectPageType() {
      const url = window.location.pathname.toLowerCase();
      const title = document.title.toLowerCase();
      
      if (url.includes('/login') || title.includes('登录')) return 'login';
      if (url.includes('/register') || title.includes('注册')) return 'register';
      if (url.includes('/profile') || title.includes('个人')) return 'profile';
      if (url.includes('/admin') || title.includes('管理')) return 'admin';
      if (url.includes('/dashboard') || title.includes('仪表板')) return 'dashboard';
      if (url.includes('/help') || title.includes('帮助')) return 'help';
      
      return 'general';
    }

    // 监听页面变化
    startObserver(callback) {
      if (this.observer) {
        this.observer.disconnect();
      }

      // 监听DOM变化
      this.observer = new MutationObserver((mutations) => {
        let hasSignificantChange = false;
        
        mutations.forEach(mutation => {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // 检查是否有重要内容添加
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName?.toLowerCase();
                if (['main', 'article', 'section', 'div'].includes(tagName)) {
                  hasSignificantChange = true;
                  break;
                }
              }
            }
          }
        });

        if (hasSignificantChange) {
          callback();
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false
      });

      // 监听URL变化（SPA应用）
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function(...args) {
        originalPushState.apply(history, args);
        setTimeout(callback, 100); // 延迟一下确保DOM更新完成
      };

      history.replaceState = function(...args) {
        originalReplaceState.apply(history, args);
        setTimeout(callback, 100);
      };

      window.addEventListener('popstate', callback);
    }

    // 停止监听
    stopObserver() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    }
  }

  // z-index层级常量
  const Z_INDEX_LEVELS = {
    // 收起状态仍需保证按钮可见，但不阻挡页面交互，因此使用较高层级同时配合 pointer-events:none
    HIDDEN: 9999,
    VISIBLE: 2147483647     // 展开状态：最高优先级
  };

  // 增强的AI助手类
  class AIAssistant {
    constructor(options = {}) {
      this.config = { ...DEFAULT_CONFIG, ...options.config };
      this.containerId = options.containerId || null;
      this.onReady = options.onReady || null;
      this.onError = options.onError || null;
      this.isLoaded = false;
      this.iframe = null;
      
      // 🆕 方案三：显示状态管理
      this.isVisible = false;  // 默认收起状态
      this.zIndexLevels = Z_INDEX_LEVELS;
      
      // 页面上下文相关
      this.pageExtractor = null;
      this.currentContext = null;
      this.contextUpdateTimer = null;
      
      // 🆕 方案A：防抖和强制更新控制
      this.contextUpdateDebounce = null;
      this.lastContextHash = '';
      this.isUpdatingContext = false;
      this.forceUpdatePromise = null;
      
      // 🆕 按钮交互区域管理
      this.buttonInteractionArea = null;

      if (this.config.enablePageContext) {
        this.initPageContext();
      }
    }

    // 初始化页面上下文功能
    initPageContext() {
      this.pageExtractor = new PageContextExtractor(this.config);
      this.updatePageContext();

      if (this.config.autoUpdateContext) {
        this.startContextMonitoring();
      }
    }

    // 🔧 方案A：原有的防抖更新方法
    updatePageContext() {
      // 防止重复调用
      if (this.isUpdatingContext) {
        console.log('⏸️ 上下文更新进行中，跳过此次调用');
        return;
      }

      // 清除之前的防抖定时器
      if (this.contextUpdateDebounce) {
        clearTimeout(this.contextUpdateDebounce);
      }

      // 设置防抖延迟
      this.contextUpdateDebounce = setTimeout(() => {
        this.doUpdatePageContext(false); // false表示非强制更新
      }, 1000); // 1秒防抖
    }

    // 🆕 方案A：强制立即更新上下文（工具调用前使用）
    async forceUpdatePageContext() {
      console.log('🔥 强制立即更新页面上下文（工具调用前）');
      
      // 如果已经有强制更新在进行，返回该Promise
      if (this.forceUpdatePromise) {
        console.log('⏸️ 强制更新已在进行中，等待完成...');
        return this.forceUpdatePromise;
      }

      // 创建强制更新Promise
      this.forceUpdatePromise = new Promise((resolve, reject) => {
        // 清除防抖定时器
        if (this.contextUpdateDebounce) {
          clearTimeout(this.contextUpdateDebounce);
          this.contextUpdateDebounce = null;
        }

        // 立即执行更新
        try {
          this.doUpdatePageContext(true, resolve); // true表示强制更新
        } catch (error) {
          reject(error);
        }
      });

      return this.forceUpdatePromise;
    }

    // 🔧 实际执行上下文更新的方法
    doUpdatePageContext(isForced = false, callback = null) {
      if (!this.pageExtractor) {
        if (callback) callback(null);
        return;
      }
      
      this.isUpdatingContext = true;
      
      try {
        console.log(isForced ? '🔥 执行强制上下文更新...' : '📄 执行常规上下文更新...');
        const context = this.pageExtractor.extractPageContent(this.config.contextDepth);
        
        // 计算上下文哈希（用于去重）
        const contextHash = JSON.stringify({
          url: context.basic.url,
          title: context.basic.title,
          headingCount: context.headings.length,
          contentLength: context.mainContent.summary?.length || 0,
          // 🆕 方案A：如果是强制更新，包含认证信息哈希
          authHash: isForced ? JSON.stringify(context.authInfo) : undefined
        });
        
        // 非强制更新时检查是否真的有变化
        if (!isForced && contextHash === this.lastContextHash) {
          console.log('📄 页面上下文无变化，跳过更新');
          if (callback) callback(this.currentContext);
          return;
        }
        
        this.lastContextHash = contextHash;
        this.currentContext = context;
        
        console.log(`✅ 页面上下文已更新 (${isForced ? '强制' : '常规'}):`, context.basic.title);
        
        // 发送更新到iframe
        if (this.isLoaded) {
          this.postMessage('updateContext', { 
            context,
            forced: isForced,
            timestamp: Date.now()
          });
        } else {
          console.log('📦 iframe未准备好，上下文将在初始化时发送');
        }
        
        if (callback) callback(context);
        
      } catch (error) {
        console.error('❌ 页面上下文提取失败:', error);
        if (callback) callback(null);
      } finally {
        this.isUpdatingContext = false;
        
        // 清理强制更新Promise
        if (isForced) {
          this.forceUpdatePromise = null;
        }
      }
    }

    // 创建容器
    createContainer() {
      if (this.containerId) {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
          throw new Error(`找不到容器元素: ${this.containerId}`);
        }
      } else {
        this.container = document.createElement('div');
        this.container.id = 'ai-assistant-container';
        // 🔧 局部穿透方案：容器保持全屏，默认为穿透状态
        this.container.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: ${this.zIndexLevels.HIDDEN};
        `;
        document.body.appendChild(this.container);
      }
    }

    // 加载样式
    loadStyles() {
      const styleId = 'ai-assistant-styles';
      if (document.getElementById(styleId)) return;

      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #ai-assistant-container * {
          box-sizing: border-box;
        }
        
        .ai-assistant-iframe {
          border: none;
          background: transparent;
          pointer-events: auto;
        }
      `;
      document.head.appendChild(style);
    }

    // 加载助手界面
    loadAssistant() {
      this.iframe = document.createElement('iframe');
      this.iframe.className = 'ai-assistant-iframe';
      
      // 🔧 局部穿透方案：iframe保持全屏，默认收起状态为穿透
      this.iframe.style.cssText = `
        position: fixed;
        width: 100%;
        height: 100%;
        top: 0;
        left: 0;
        z-index: ${this.zIndexLevels.HIDDEN};
        pointer-events: none;
        background: transparent;
      `;

      const params = new URLSearchParams({
        config: JSON.stringify(this.config),
        embedded: 'true'
      });
      
      this.iframe.src = `${this.config.baseUrl}/embed?${params.toString()}`;

      this.iframe.onload = () => {
        this.isLoaded = true;
        if (this.onReady) {
          this.onReady();
        }
        this.setupMessageHandling();
        
        // 发送初始页面上下文
        if (this.currentContext) {
          this.postMessage('updateContext', { context: this.currentContext });
        }
        
        // 🔑 重要：立即发送悬浮按钮可点击状态（因为默认是收起状态）
        setTimeout(() => {
          if (this.iframe && this.iframe.contentWindow) {
            this.iframe.contentWindow.postMessage({
              type: 'needFloatingButtonClickable',
              data: { 
                clickable: !this.isVisible // 收起状态时需要悬浮按钮可点击
              }
            }, '*');
            console.log('📤 发送初始悬浮按钮状态:', !this.isVisible);
          }
        }, 100); // 延迟100ms确保iframe内容完全加载
      };

      this.iframe.onerror = (error) => {
        console.error('AI Assistant iframe 加载失败:', error);
        if (this.onError) {
          this.onError(new Error('助手加载失败'));
        }
      };

      this.container.appendChild(this.iframe);
    }

    // 🔧 方案A：修复后的消息处理
    setupMessageHandling() {
      window.addEventListener('message', (event) => {
        if (event.origin !== new URL(this.config.baseUrl).origin) {
          return;
        }

        const { type, data } = event.data;
        console.log('父页面收到消息:', type, data);

        switch (type) {
          case 'ai-assistant-ready':
            console.log('AI Assistant 准备就绪');
            // 🔑 修复：立即发送初始化消息
            this.postMessage('init', { 
              config: this.config,
              context: this.currentContext,
              timestamp: Date.now()
            });
            
            // 🔑 重要：AI助手准备就绪后立即发送悬浮按钮状态
            setTimeout(() => {
              if (this.iframe && this.iframe.contentWindow) {
                this.iframe.contentWindow.postMessage({
                  type: 'needFloatingButtonClickable',
                  data: { 
                    clickable: !this.isVisible // 收起状态时需要悬浮按钮可点击
                  }
                }, '*');
                console.log('📤 AI助手就绪后发送悬浮按钮状态:', !this.isVisible);
              }
            }, 50);
            break;
          
          case 'ai-assistant-resize':
            this.handleResize(data);
            break;
          
          case 'ai-assistant-error':
            console.error('AI Assistant 错误:', data);
            if (this.onError) {
              this.onError(new Error(data.message));
            }
            break;

          case 'ai-assistant-requestPageContext':
            console.log('收到上下文请求，开始更新页面上下文...');
            this.updatePageContext();
            break;
          
          // 🆕 方案A：处理工具调用前的强制上下文更新请求
          case 'ai-assistant-forceContextUpdate':
            console.log('收到强制上下文更新请求...');
            this.forceUpdatePageContext().then(context => {
              this.postMessage('contextUpdateComplete', { 
                context,
                requestId: data.requestId 
              });
            });
            break;
          
          // 🆕 方案三：处理显示状态变化消息
          case 'ai-assistant-show':
            console.log('收到展开消息');
            this.updateDisplayState(true);
            break;
          
          case 'ai-assistant-hide':
            console.log('收到收起消息');
            this.updateDisplayState(false);
            break;
          
          case 'ai-assistant-stateChange':
            console.log('收到助手状态变化:', data);
            this.handleAssistantStateChange(data);
            break;
          
          default:
            break;
        }
      });
    }

    // 发送消息给iframe
    postMessage(type, data = {}) {
      if (this.iframe && this.iframe.contentWindow) {
        this.iframe.contentWindow.postMessage(
          { type: `ai-assistant-${type}`, data },
          this.config.baseUrl
        );
      }
    }

    // 处理助手状态变化
    handleAssistantStateChange(stateData) {
      const { isOpen, position, buttonSize, offset } = stateData;
      
      if (!this.iframe) return;
      
      if (isOpen) {
        // 展开状态：允许iframe接收所有事件
        this.iframe.style.pointerEvents = 'auto';
        console.log('✅ 助手展开 - iframe启用完整交互');
        
        // 移除可能存在的交互区域
        this.removeInteractionArea();
        
      } else {
        // 收起状态：禁用iframe事件，创建精准交互区域
        this.iframe.style.pointerEvents = 'none';
        console.log('✅ 助手收起 - iframe禁用交互，创建按钮交互区域');
        
        // 创建精准的按钮交互区域
        this.createButtonInteractionArea(position, buttonSize, offset);
      }
    }

    // 创建按钮交互区域
    createButtonInteractionArea(position, buttonSize, offset) {
      // 移除已存在的交互区域
      this.removeInteractionArea();
      
      // 创建交互区域元素
      this.buttonInteractionArea = document.createElement('div');
      this.buttonInteractionArea.id = 'ai-assistant-button-area';
      this.buttonInteractionArea.style.cssText = `
        position: fixed;
        width: ${buttonSize.width}px;
        height: ${buttonSize.height}px;
        ${this.getPositionCSS(position, offset)};
        z-index: 2147483648;
        pointer-events: auto;
        background: transparent;
        border-radius: 16px;
        cursor: pointer;
      `;
      
      // 点击事件：通知iframe展开助手
      this.buttonInteractionArea.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('🖱️ 点击悬浮按钮区域，通知iframe展开助手');
        this.postMessage('buttonClicked', { action: 'open' });
      });
      
      // 添加到页面
      document.body.appendChild(this.buttonInteractionArea);
      console.log('✅ 创建按钮交互区域:', buttonSize);
    }

    // 移除交互区域
    removeInteractionArea() {
      if (this.buttonInteractionArea) {
        this.buttonInteractionArea.remove();
        this.buttonInteractionArea = null;
        console.log('🗑️ 移除按钮交互区域');
      }
    }

    // 根据位置配置生成CSS
    getPositionCSS(position, offset) {
      switch (position) {
        case 'bottom-left':
          return `bottom: ${offset.bottom}px; left: ${offset.left || 16}px;`;
        case 'top-right':
          return `top: ${offset.top || 16}px; right: ${offset.right}px;`;
        case 'top-left':
          return `top: ${offset.top || 16}px; left: ${offset.left || 16}px;`;
        default: // bottom-right
          return `bottom: ${offset.bottom}px; right: ${offset.right}px;`;
      }
    }

    // 🔧 局部穿透方案：通过pointer-events控制穿透，iframe内部处理悬浮按钮可点击
    updateDisplayState(isVisible) {
      console.log(`🔄 更新显示状态: ${isVisible ? '展开' : '收起'}`);
      
      this.isVisible = isVisible;
      
      if (this.iframe) {
        if (isVisible) {
          // 展开状态：最高层级 + 可交互
          this.iframe.style.zIndex = this.zIndexLevels.VISIBLE;
          this.iframe.style.pointerEvents = 'auto';
          console.log('✅ 助手已展开 - 最高优先级，可完全交互');
        } else {
          // 收起状态：点击穿透，iframe内部需要特殊处理悬浮按钮
          this.iframe.style.zIndex = this.zIndexLevels.HIDDEN;
          this.iframe.style.pointerEvents = 'none';
          console.log('✅ 助手已收起 - 点击穿透，Vue页面可正常交互');
        }
      }
      
      // 同步更新容器
      if (this.container) {
        this.container.style.zIndex = isVisible ? this.zIndexLevels.VISIBLE : this.zIndexLevels.HIDDEN;
        this.container.style.pointerEvents = isVisible ? 'auto' : 'none';
      }
      
      // 🔑 关键：通知iframe内部状态变化，让内部处理悬浮按钮的局部可点击
      this.postMessage('displayStateChanged', { 
        isVisible,
        needFloatingButtonClickable: !isVisible // 收起时需要悬浮按钮可点击
      });
      
      // 单独发送悬浮按钮可点击状态消息
      if (this.iframe && this.iframe.contentWindow) {
        this.iframe.contentWindow.postMessage({
          type: 'needFloatingButtonClickable',
          data: { 
            clickable: !isVisible // 收起状态时需要悬浮按钮可点击
          }
        }, '*');
      }
    }

    // 处理大小调整
    handleResize(data) {
      if (this.iframe) {
        // 可根据需要调整iframe大小
      }
    }

    // 启动上下文监控
    startContextMonitoring() {
      if (!this.config.enablePageContext) return;
      
      this.updatePageContext();
      
      if (this.config.autoUpdateContext) {
        this.contextMonitorInterval = setInterval(() => {
          this.updatePageContext();
        }, this.config.contextUpdateInterval || 30000);
      }
    }

    // 停止上下文监控
    stopContextMonitoring() {
      if (this.contextMonitorInterval) {
        clearInterval(this.contextMonitorInterval);
        this.contextMonitorInterval = null;
      }
    }

    // 初始化
    init() {
      this.createContainer();
      this.loadStyles();
      this.loadAssistant();
      this.startContextMonitoring();
    }

    // 🆕 方案三：增强的公共API方法
    show() {
      console.log('🔧 调用show() - 展开助手');
      this.updateDisplayState(true);
      this.postMessage('show');
    }

    hide() {
      console.log('🔧 调用hide() - 收起助手'); 
      this.updateDisplayState(false);
      this.postMessage('hide');
    }

    // 🆕 获取当前显示状态
    isAssistantVisible() {
      return this.isVisible;
    }

    // 🆕 切换显示状态
    toggle() {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show();
      }
    }

    // 手动更新页面上下文
    refreshContext() {
      this.updatePageContext();
    }

    // 🆕 方案A：工具调用前强制刷新上下文的公共API
    async refreshContextForTools() {
      console.log('🔧 准备工具调用，强制刷新页面上下文...');
      return this.forceUpdatePageContext();
    }

    // 获取当前页面上下文（用于调试）
    getPageContext() {
      return this.currentContext;
    }

    // 销毁助手
    destroy() {
      this.stopContextMonitoring();
      
      // 清理交互区域
      this.removeInteractionArea();
      
      // 🆕 方案三：重置显示状态
      this.isVisible = false;
      
      if (this.iframe) {
        this.iframe.remove();
        this.iframe = null;
      }
      
      if (this.container && this.container.id === 'ai-assistant-container') {
        this.container.remove();
      }
      
      this.isLoaded = false;
    }

    // 更新配置
    updateConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };
      this.postMessage('updateConfig', { config: this.config });
    }
  }

  // 创建全局构造函数
  window.AIAssistant = AIAssistant;

  // 提供便捷的初始化方法
  window.initAIAssistant = function(options = {}) {
    const assistant = new AIAssistant(options);
    assistant.init();
    return assistant;
  };

  // 自动初始化
  document.addEventListener('DOMContentLoaded', function() {
    const autoInitScript = document.querySelector('script[data-ai-assistant-auto]');
    if (autoInitScript) {
      try {
        const config = JSON.parse(autoInitScript.getAttribute('data-config') || '{}');
        window.initAIAssistant({ config });
      } catch (error) {
        console.error('AI Assistant 自动初始化失败:', error);
      }
    }
  });

})(window, document);