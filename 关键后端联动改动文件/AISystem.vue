<template>
  <div class="ai-system-container">
    <div class="iframe-container">
      <iframe 
        src="/assistant/" 
        class="next-app-iframe"
        frameborder="0"
        allowfullscreen
        title="AI助残应用">
      </iframe>
    </div>
  </div>
</template>

<script>
export default {
  name:'AISystem',
}
</script>

<style lang="scss" scoped>
.ai-system-container {
  position: fixed;
  top: 60px; // 假设导航栏高度为60px，可根据实际情况调整
  left: 0;
  width: 100vw;
  height: calc(100vh - 60px); // 减去导航栏高度
  margin: 0;
  padding: 0;
  overflow: hidden;
  
  .iframe-container {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    
    .next-app-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      margin: 0;
      padding: 0;
    }
  }
}

// 确保全局样式不影响
:global(body) {
  margin: 0;
  padding: 0;
}
</style>