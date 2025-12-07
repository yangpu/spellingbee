<template>
  <div class="letter-input-container" @click="handleContainerClick">
    <div class="letter-slots">
      <div
        v-for="(slot, i) in letterSlots"
        :key="i"
        class="letter-slot"
        :class="{
          'slot-active': i === currentLetterIndex && !disabled,
          'slot-filled': slot.value,
          'slot-correct': slot.status === 'correct',
          'slot-wrong': slot.status === 'wrong'
        }"
        @click="focusInput(i)"
      >
        <input
          :ref="el => inputRefs[i] = el"
          type="text"
          maxlength="1"
          class="letter-input"
          :value="slot.value"
          :disabled="disabled"
          @input="handleInput($event, i)"
          @keydown="handleKeydown($event, i)"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd($event, i)"
          @focus="handleFocus($event, i)"
          @blur="handleBlur"
          @beforeinput="handleBeforeInput"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="next"
          inputmode="text"
        />
        <span class="letter-hint" v-if="showFirstLetterHint && i === 0 && !slot.value && word">
          {{ word[0]?.toUpperCase() }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, computed } from 'vue'

const props = defineProps({
  word: {
    type: String,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  },
  showFirstLetterHint: {
    type: Boolean,
    default: true
  },
  autoSubmit: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['submit', 'change'])

// 检测移动端
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

// 状态
const letterSlots = ref([])
const inputRefs = ref([])
const currentLetterIndex = ref(0)
const isComposing = ref(false)
const handledByKeydown = ref(false)
const pendingMoveToNext = ref(null)
const lastInputRecord = ref({})
const duplicateThreshold = 100
const blurTimeout = ref(null) // 失焦后自动聚焦的定时器

// 计算属性
const isAllFilled = computed(() => letterSlots.value.every(slot => slot.value))
const currentAnswer = computed(() => letterSlots.value.map(s => s.value).join(''))

// 监听单词变化，重置输入框
watch(() => props.word, (newWord) => {
  if (newWord) {
    resetSlots()
  }
}, { immediate: true })

// 重置输入框
function resetSlots() {
  letterSlots.value = props.word.split('').map(() => ({
    value: '',
    status: 'empty'
  }))
  currentLetterIndex.value = 0
  handledByKeydown.value = false
  lastInputRecord.value = {}
  
  if (pendingMoveToNext.value) {
    clearTimeout(pendingMoveToNext.value)
    pendingMoveToNext.value = null
  }
  
  if (blurTimeout.value) {
    clearTimeout(blurTimeout.value)
    blurTimeout.value = null
  }
  
  nextTick(() => {
    if (inputRefs.value[0] && !props.disabled) {
      inputRefs.value[0].focus()
    }
  })
}

// 检查是否是重复输入
function isDuplicateInput(index, value) {
  const now = Date.now()
  const record = lastInputRecord.value[index]
  if (record && record.value === value && now - record.time < duplicateThreshold) {
    return true
  }
  return false
}

// 记录输入
function recordInput(index, value) {
  lastInputRecord.value[index] = { value, time: Date.now() }
}

// 统一的字母输入处理函数
function processLetterInput(value, index, inputElement) {
  if (props.disabled) return
  
  recordInput(index, value)
  letterSlots.value[index].value = value
  if (inputElement) {
    inputElement.value = value
  }
  
  // 检查是否正确
  const correctLetter = props.word[index]?.toLowerCase()
  letterSlots.value[index].status = value === correctLetter ? 'correct' : 'wrong'
  
  emit('change', currentAnswer.value)
  
  // 取消之前的待执行移动操作
  if (pendingMoveToNext.value) {
    clearTimeout(pendingMoveToNext.value)
    pendingMoveToNext.value = null
  }
  
  // 移动到下一个框或自动提交
  if (index < letterSlots.value.length - 1) {
    pendingMoveToNext.value = setTimeout(() => {
      currentLetterIndex.value = index + 1
      const nextInput = inputRefs.value[index + 1]
      if (nextInput) {
        nextInput.value = letterSlots.value[index + 1].value || ''
        nextInput.focus()
      }
      pendingMoveToNext.value = null
    }, isMobile ? 80 : 20)
  } else {
    // 输入最后一个字母后检查是否自动提交
    currentLetterIndex.value = index
    pendingMoveToNext.value = setTimeout(() => {
      if (isAllFilled.value && props.autoSubmit) {
        emit('submit', currentAnswer.value)
      }
      pendingMoveToNext.value = null
    }, isMobile ? 100 : 50)
  }
}

// 处理输入
function handleInput(event, index) {
  if (props.disabled) return
  if (isComposing.value) return
  if (handledByKeydown.value) {
    handledByKeydown.value = false
    event.target.value = letterSlots.value[index].value || ''
    return
  }
  
  if (isMobile) {
    event.target.value = letterSlots.value[index].value || ''
    return
  }
  
  const inputValue = event.target.value || ''
  const letters = inputValue.replace(/[^a-zA-Z]/g, '').toLowerCase()
  
  if (!letters) {
    event.target.value = letterSlots.value[index].value || ''
    return
  }
  
  const value = letters.charAt(0)
  
  if (letterSlots.value[index].value === value) {
    event.target.value = value
    return
  }
  
  if (isDuplicateInput(index, value)) {
    event.target.value = letterSlots.value[index].value || value
    return
  }
  
  processLetterInput(value, index, event.target)
}

// 处理键盘事件
function handleKeydown(event, index) {
  if (props.disabled) return
  
  if (event.key === 'Backspace') {
    event.preventDefault()
    handledByKeydown.value = true
    
    if (letterSlots.value[index].value) {
      letterSlots.value[index].value = ''
      letterSlots.value[index].status = 'empty'
      if (inputRefs.value[index]) {
        inputRefs.value[index].value = ''
      }
      emit('change', currentAnswer.value)
    } else if (index > 0) {
      currentLetterIndex.value = index - 1
      letterSlots.value[index - 1].value = ''
      letterSlots.value[index - 1].status = 'empty'
      nextTick(() => {
        const prevInput = inputRefs.value[index - 1]
        if (prevInput) {
          prevInput.value = ''
          prevInput.focus()
        }
        setTimeout(() => { handledByKeydown.value = false }, 50)
      })
      emit('change', currentAnswer.value)
      return
    }
    
    setTimeout(() => { handledByKeydown.value = false }, 50)
  } else if (event.key === 'Enter') {
    if (isAllFilled.value) {
      emit('submit', currentAnswer.value)
    }
  } else if (event.key === 'ArrowLeft' && index > 0) {
    currentLetterIndex.value = index - 1
    inputRefs.value[index - 1]?.focus()
  } else if (event.key === 'ArrowRight' && index < letterSlots.value.length - 1) {
    currentLetterIndex.value = index + 1
    inputRefs.value[index + 1]?.focus()
  } else if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault()
    handledByKeydown.value = true
    
    const value = event.key.toLowerCase()
    
    if (letterSlots.value[index].value === value) {
      handledByKeydown.value = false
      return
    }
    
    processLetterInput(value, index, inputRefs.value[index])
    
    setTimeout(() => { handledByKeydown.value = false }, 30)
  }
}

// IME 组合输入
function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd(event, index) {
  isComposing.value = false
  
  const inputValue = event.target.value || ''
  const letters = inputValue.replace(/[^a-zA-Z]/g, '').toLowerCase()
  
  if (!letters) {
    event.target.value = letterSlots.value[index].value || ''
    return
  }
  
  const value = letters.charAt(0)
  
  if (letterSlots.value[index].value === value) {
    event.target.value = value
    return
  }
  
  if (isDuplicateInput(index, value)) {
    event.target.value = letterSlots.value[index].value || value
    return
  }
  
  processLetterInput(value, index, event.target)
}

// 处理焦点
function handleFocus(event, index) {
  // 清除失焦定时器
  if (blurTimeout.value) {
    clearTimeout(blurTimeout.value)
    blurTimeout.value = null
  }
  currentLetterIndex.value = index
  handledByKeydown.value = false
  const correctValue = letterSlots.value[index].value || ''
  event.target.value = correctValue.charAt(0)
}

// 处理失焦 - 延迟后自动聚焦到当前激活框
function handleBlur() {
  if (props.disabled) return
  
  // 清除之前的定时器
  if (blurTimeout.value) {
    clearTimeout(blurTimeout.value)
  }
  
  // 延迟检查，如果没有其他输入框获得焦点，则重新聚焦
  blurTimeout.value = setTimeout(() => {
    // 检查当前文档焦点是否在组件内
    const activeElement = document.activeElement
    const isInComponent = inputRefs.value.some(ref => ref === activeElement)
    
    if (!isInComponent && !props.disabled) {
      // 找到第一个空位或当前位置
      let targetIndex = letterSlots.value.findIndex(slot => !slot.value)
      if (targetIndex === -1) {
        targetIndex = currentLetterIndex.value
      }
      const targetInput = inputRefs.value[targetIndex]
      if (targetInput) {
        targetInput.focus()
      }
    }
    blurTimeout.value = null
  }, 100)
}

// 点击容器时聚焦到当前激活框
function handleContainerClick(event) {
  if (props.disabled) return
  
  // 如果点击的不是输入框，聚焦到当前激活框
  if (event.target.tagName !== 'INPUT') {
    // 找到第一个空位或当前位置
    let targetIndex = letterSlots.value.findIndex(slot => !slot.value)
    if (targetIndex === -1) {
      targetIndex = currentLetterIndex.value
    }
    const targetInput = inputRefs.value[targetIndex]
    if (targetInput) {
      targetInput.focus()
    }
  }
}

// 处理 beforeinput
function handleBeforeInput(event) {
  if (props.disabled) return
  if (event.isComposing || isComposing.value) return
  
  if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
    return
  }
  
  const data = event.data
  if (!data) return
  
  const hasLetter = /[a-zA-Z]/.test(data)
  if (!hasLetter) {
    event.preventDefault()
    return
  }
  
  if (handledByKeydown.value) {
    event.preventDefault()
    return
  }
  
  const inputElement = event.target
  const currentIndex = inputRefs.value.findIndex(ref => ref === inputElement)
  if (currentIndex === -1) return
  
  const letters = data.replace(/[^a-zA-Z]/g, '').toLowerCase()
  if (!letters) {
    event.preventDefault()
    return
  }
  
  const value = letters.charAt(0)
  
  if (isDuplicateInput(currentIndex, value)) {
    event.preventDefault()
    return
  }
  
  if (isMobile) {
    event.preventDefault()
    if (letterSlots.value[currentIndex].value === value) return
    processLetterInput(value, currentIndex, inputElement)
    return
  }
  
  if (data.length > 1) {
    const multiLetters = data.replace(/[^a-zA-Z]/g, '').toLowerCase()
    if (multiLetters.length > 1) {
      event.preventDefault()
      return
    }
  }
}

// 聚焦输入框
function focusInput(index) {
  if (props.disabled) return
  currentLetterIndex.value = index
  const input = inputRefs.value[index]
  if (input) {
    const correctValue = letterSlots.value[index].value || ''
    input.value = correctValue.charAt(0)
    input.focus()
    if (input.value) {
      input.select()
    }
  }
}

// 暴露方法
defineExpose({
  reset: resetSlots,
  getAnswer: () => currentAnswer.value,
  isFilled: () => isAllFilled.value,
  focus: () => inputRefs.value[0]?.focus()
})
</script>

<style lang="scss" scoped>
.letter-input-container {
  .letter-slots {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;

    .letter-slot {
      width: 48px;
      height: 60px;
      position: relative;
      background: var(--hover-bg);
      border: 2px solid var(--charcoal-200);
      border-radius: 8px;
      transition: all 0.2s;

      &.slot-active {
        border-color: var(--honey-500);
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
      }

      &.slot-filled {
        background: var(--honey-50);
        border-color: var(--honey-400);
      }

      &.slot-correct {
        background: var(--success-light, #d1fae5);
        border-color: var(--success);

        .letter-input {
          color: var(--success);
        }
      }

      &.slot-wrong {
        background: var(--error-light, #fee2e2);
        border-color: var(--error);

        .letter-input {
          color: var(--error);
        }
      }

      .letter-input {
        width: 100%;
        height: 100%;
        border: none;
        background: transparent;
        text-align: center;
        font-size: 1.75rem;
        font-weight: 700;
        text-transform: uppercase;
        outline: none;

        &:disabled {
          cursor: not-allowed;
          opacity: 0.8;
        }
      }

      .letter-hint {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--charcoal-300);
        pointer-events: none;
      }
    }
  }
}

@media (max-width: 768px) {
  .letter-input-container .letter-slots .letter-slot {
    width: 36px;
    height: 48px;

    .letter-input {
      font-size: 1.25rem;
    }

    .letter-hint {
      font-size: 1.1rem;
    }
  }
}
</style>
