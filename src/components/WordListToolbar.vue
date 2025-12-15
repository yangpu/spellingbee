<template>
  <div class="word-list-toolbar">
    <!-- 筛选区域 -->
    <div class="toolbar-filter">
      <!-- PC端分类统计筛选 -->
      <div class="filter-tabs filter-tabs-pc" v-if="!hideFilter">
        <div 
          v-for="option in filterOptions" 
          :key="option.value"
          class="filter-tab" 
          :class="[option.type || '', { active: modelValue.filter === option.value }]"
          @click="updateFilter(option.value)"
        >
          <t-icon v-if="option.icon" :name="option.icon" />
          <span class="filter-label">{{ option.label }}</span>
          <span class="filter-count" :class="option.type">{{ option.count }}</span>
        </div>
      </div>
      
      <!-- 移动端下拉筛选 -->
      <div class="filter-select-mobile" v-if="!hideFilter">
        <t-select
          :value="modelValue.filter"
          size="small"
          @change="updateFilter"
        >
          <t-option 
            v-for="option in filterOptions" 
            :key="option.value"
            :value="option.value" 
            :label="`${option.label} (${option.count})`" 
          />
        </t-select>
      </div>
      
      <!-- 搜索框 -->
      <div class="toolbar-search" v-if="!hideSearch">
        <t-input
          :value="modelValue.keyword"
          placeholder="搜索单词..."
          clearable
          size="small"
          @change="updateKeyword"
        >
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // v-model 绑定的值：{ filter, keyword, page, pageSize }
  modelValue: {
    type: Object,
    required: true,
    default: () => ({
      filter: 'all',
      keyword: '',
      page: 1,
      pageSize: 10
    })
  },
  // 筛选选项：[{ value, label, icon?, type?, count }]
  filterOptions: {
    type: Array,
    default: () => []
  },
  // 隐藏筛选
  hideFilter: {
    type: Boolean,
    default: false
  },
  // 隐藏搜索
  hideSearch: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

function updateFilter(value) {
  const newValue = { ...props.modelValue, filter: value, page: 1 }
  emit('update:modelValue', newValue)
  emit('change', newValue)
}

function updateKeyword(value) {
  const newValue = { ...props.modelValue, keyword: value, page: 1 }
  emit('update:modelValue', newValue)
  emit('change', newValue)
}
</script>

<style lang="scss" scoped>
.word-list-toolbar {
  .toolbar-filter {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  
  .filter-tabs-pc {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  
  .filter-select-mobile {
    display: none;
    min-width: 130px;
  }
  
  .filter-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.75rem;
    background: var(--bg-card);
    border-radius: 16px;
    cursor: pointer;
    transition: all 0.2s;
    border: 2px solid transparent;
    font-size: 0.85rem;
    
    &:hover {
      background: var(--hover-bg);
    }
    
    &.active {
      border-color: var(--honey-400);
      background: var(--honey-50);
    }
    
    // 正确/已掌握类型
    &.correct, &.mastered {
      .t-icon {
        color: var(--success);
      }
      &.active {
        border-color: var(--success);
        background: var(--success-light, #d1fae5);
      }
    }
    
    // 错误/待复习类型
    &.wrong, &.review {
      .t-icon {
        color: var(--error);
      }
      &.active {
        border-color: var(--error);
        background: var(--error-light, #fee2e2);
      }
    }
    
    // 其他/超时类型
    &.other, &.timeout {
      .t-icon {
        color: var(--text-secondary);
      }
      &.active {
        border-color: var(--charcoal-400);
        background: var(--charcoal-100);
      }
    }
    
    .filter-label {
      color: var(--text-primary);
    }
    
    .filter-count {
      font-weight: 600;
      color: var(--honey-600);
      background: var(--honey-100);
      padding: 0.1rem 0.4rem;
      border-radius: 10px;
      font-size: 0.75rem;
      min-width: 1.5em;
      text-align: center;
      
      &.correct, &.mastered {
        color: var(--success);
        background: var(--success-light, #d1fae5);
      }
      
      &.wrong, &.review {
        color: var(--error);
        background: var(--error-light, #fee2e2);
      }
      
      &.other, &.timeout {
        color: var(--text-secondary);
        background: var(--charcoal-100);
      }
    }
  }
  
  .toolbar-search {
    width: 180px;
    flex-shrink: 0;
  }
}

// 移动端适配
@media (max-width: 768px) {
  .word-list-toolbar {
    .toolbar-filter {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }
    
    .filter-tabs-pc {
      display: none;
    }
    
    .filter-select-mobile {
      display: block;
    }
    
    .toolbar-search {
      width: 100%;
    }
  }
}
</style>
