# kokoro-tts-service/config_china.py
"""
国内镜像站配置文件
为中国用户优化的网络配置
"""

import os
from typing import Dict, List

class ChinaMirrorConfig:
    """国内镜像站配置类"""
    
    # ============ HuggingFace 镜像配置 ============
    HUGGINGFACE_MIRRORS = {
        "official": "https://huggingface.co",
        "aliyun": "https://hf-mirror.com",           # 阿里云镜像 (推荐)
        "tencent": "https://huggingface.co",         # 腾讯云 (备用)
        "baidu": "https://aistudio.baidu.com/hf",    # 百度飞桨 (备用)
    }
    
    # ============ PyPI 镜像配置 ============
    PYPI_MIRRORS = {
        "tsinghua": "https://pypi.tuna.tsinghua.edu.cn/simple",
        "aliyun": "https://mirrors.aliyun.com/pypi/simple",
        "tencent": "https://mirrors.cloud.tencent.com/pypi/simple",
        "douban": "https://pypi.douban.com/simple",
        "ustc": "https://pypi.mirrors.ustc.edu.cn/simple",
    }
    
    # ============ 默认配置 ============
    DEFAULT_SETTINGS = {
        # HuggingFace配置
        "HF_ENDPOINT": HUGGINGFACE_MIRRORS["aliyun"],
        "HUGGINGFACE_HUB_CACHE": "./cache/huggingface",
        "HF_HOME": "./cache/huggingface",
        
        # PyTorch配置
        "TORCH_HOME": "./cache/torch",
        
        # 网络配置
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "CURL_CA_BUNDLE": "",
        "REQUESTS_CA_BUNDLE": "",
        
        # 性能配置
        "OMP_NUM_THREADS": "4",
        "MKL_NUM_THREADS": "4",
        "NUMEXPR_NUM_THREADS": "4",
        
        # Kokoro特定配置
        "KOKORO_SAMPLE_RATE": "22050",
        "KOKORO_DEFAULT_SPEED": "1.2",
        "KOKORO_CHUNK_DELAY": "0.005",
        "KOKORO_MAX_CHUNK_LENGTH": "30",
        "KOKORO_USE_CHINA_MIRRORS": "true",
    }
    
    @classmethod
    def setup_environment(cls, mirror_preference: str = "auto") -> Dict[str, str]:
        """
        设置环境变量，优化国内网络访问
        
        Args:
            mirror_preference: 镜像偏好 ("auto", "aliyun", "tsinghua", etc.)
        
        Returns:
            设置的环境变量字典
        """
        env_vars = cls.DEFAULT_SETTINGS.copy()
        
        # 自动选择最优镜像
        if mirror_preference == "auto":
            env_vars["HF_ENDPOINT"] = cls._select_best_hf_mirror()
        elif mirror_preference in cls.HUGGINGFACE_MIRRORS:
            env_vars["HF_ENDPOINT"] = cls.HUGGINGFACE_MIRRORS[mirror_preference]
        
        # 应用环境变量
        for key, value in env_vars.items():
            os.environ[key] = str(value)
        
        return env_vars
    
    @classmethod
    def _select_best_hf_mirror(cls) -> str:
        """自动选择最快的HuggingFace镜像"""
        import time
        import requests
        
        best_mirror = cls.HUGGINGFACE_MIRRORS["aliyun"]  # 默认使用阿里云
        
        try:
            # 简单的延迟测试
            test_url = f"{cls.HUGGINGFACE_MIRRORS['aliyun']}/api/models"
            start_time = time.time()
            response = requests.get(test_url, timeout=5)
            if response.status_code == 200:
                latency = time.time() - start_time
                print(f"✅ 阿里云镜像延迟: {latency:.2f}秒")
                return cls.HUGGINGFACE_MIRRORS["aliyun"]
        except:
            print("⚠️ 阿里云镜像测试失败，使用默认配置")
        
        return best_mirror
    
    @classmethod
    def get_pip_install_command(cls, package: str = None) -> str:
        """获取使用国内镜像的pip安装命令"""
        mirror_url = cls.PYPI_MIRRORS["tsinghua"]
        
        if package:
            return f"pip install -i {mirror_url} {package}"
        else:
            return f"pip install -i {mirror_url} -r requirements.txt"
    
    @classmethod
    def create_pip_config(cls) -> str:
        """创建pip配置文件内容"""
        return f"""[global]
index-url = {cls.PYPI_MIRRORS["tsinghua"]}
trusted-host = pypi.tuna.tsinghua.edu.cn
timeout = 60

[install]
trusted-host = pypi.tuna.tsinghua.edu.cn
"""

    @classmethod
    def check_network_connectivity(cls) -> Dict[str, bool]:
        """检查各个镜像站的连通性"""
        import requests
        
        connectivity = {}
        
        # 检查HuggingFace镜像
        for name, url in cls.HUGGINGFACE_MIRRORS.items():
            try:
                response = requests.get(f"{url}", timeout=10)
                connectivity[f"hf_{name}"] = response.status_code == 200
            except:
                connectivity[f"hf_{name}"] = False
        
        # 检查PyPI镜像
        for name, url in cls.PYPI_MIRRORS.items():
            try:
                # PyPI simple API测试
                response = requests.get(f"{url}/pip/", timeout=10)
                connectivity[f"pypi_{name}"] = response.status_code == 200
            except:
                connectivity[f"pypi_{name}"] = False
        
        return connectivity

# 全局配置实例
china_config = ChinaMirrorConfig()

# 在模块加载时自动设置环境
if os.getenv("KOKORO_USE_CHINA_MIRRORS", "true").lower() == "true":
    china_config.setup_environment()
    print("🇨🇳 已启用国内镜像站配置")