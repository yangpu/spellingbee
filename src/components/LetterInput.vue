<template>
  <div class="letter-input-container" @click="handleContainerClick">
    <div class="letter-slots">
      <template v-for="(slot, i) in visibleSlots" :key="i">
        <div
          v-if="slot.visible"
          class="letter-slot"
          :class="{
            'slot-active': i === currentLetterIndex && !disabled,
            'slot-filled': slot.value,
            'slot-correct': slot.status === 'correct',
            'slot-wrong': slot.status === 'wrong',
            'slot-missing': slot.status === 'missing'
          }"
          @click="focusInput(i)"
        >
          <input
            :ref="el => inputRefs[i] = el"
            type="text"
            maxlength="1"
            class="letter-input"
            :value="letterSlots[i]?.value || ''"
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
      </template>
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
  },
  // 外部传入的字母数组，用于恢复状态
  letters: {
    type: String,
    default: ''
  },
  // 辅助输入模式：true显示所有字母框和颜色提示，false逐个显示无颜色提示
  assistedMode: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['submit', 'change', 'update:letters'])

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
const isSubmitted = ref(false) // 是否已提交答案（用于非辅助模式显示颜色）

// 计算属性
const isAllFilled = computed(() => {
  if (props.assistedMode) {
    // 辅助模式：所有框都填满
    return letterSlots.value.every(slot => slot.value)
  } else {
    // 非辅助模式：至少输入了一个字母
    return letterSlots.value.some(slot => slot.value)
  }
})
const currentAnswer = computed(() => letterSlots.value.map(s => s.value).join(''))

// 非辅助模式下，只显示已填写的字母框 + 下一个空框
const visibleSlots = computed(() => {
  if (props.assistedMode) {
    // 辅助模式：显示所有字母框
    return letterSlots.value.map((slot, i) => ({ ...slot, index: i, visible: true }))
  }
  // 非辅助模式：显示所有已有的字母框（动态增长）
  return letterSlots.value.map((slot, i) => ({ 
    ...slot, 
    index: i, 
    visible: true 
  }))
})

// 监听单词变化，重置输入框
watch(() => props.word, (newWord, oldWord) => {
  if (newWord) {
    // 单词变化时重置
    if (newWord !== oldWord) {
      resetSlots()
    }
  }
}, { immediate: true })

// 监听外部 letters 变化，同步到内部
// 使用 immediate: true 确保初始值也能被处理
watch(() => props.letters, (newLetters) => {
  if (newLetters) {
    // 如果 letterSlots 还没初始化，等待下一个 tick
    if (letterSlots.value.length === 0) {
      nextTick(() => {
        if (letterSlots.value.length > 0 && props.letters) {
          const currentValue = currentAnswer.value
          if (props.letters !== currentValue) {
            setValueInternal(props.letters)
          }
        }
      })
    } else {
      const currentValue = currentAnswer.value
      if (newLetters !== currentValue) {
        setValueInternal(newLetters)
      }
    }
  }
}, { immediate: true })

// 重置输入框
function resetSlots() {
  isSubmitted.value = false
  if (props.assistedMode) {
    // 辅助模式：按单词长度创建固定数量的字母框
    letterSlots.value = props.word.split('').map(() => ({
      value: '',
      status: 'empty'
    }))
  } else {
    // 非辅助模式：初始只有一个空字母框
    letterSlots.value = [{
      value: '',
      status: 'empty'
    }]
  }
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
  
  // 辅助模式：实时检查是否正确并显示颜色
  // 非辅助模式：输入时不显示颜色（提交后才显示）
  if (props.assistedMode) {
    const correctLetter = props.word[index]?.toLowerCase()
    letterSlots.value[index].status = value === correctLetter ? 'correct' : 'wrong'
  } else {
    letterSlots.value[index].status = 'filled'
  }
  
  const answer = currentAnswer.value
  emit('change', answer)
  emit('update:letters', answer)
  
  // 取消之前的待执行移动操作
  if (pendingMoveToNext.value) {
    clearTimeout(pendingMoveToNext.value)
    pendingMoveToNext.value = null
  }
  
  // 移动到下一个框或自动提交
  if (props.assistedMode) {
    // 辅助模式：固定字母框数量
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
  } else {
    // 非辅助模式：动态添加新字母框
    // 添加一个新的空字母框
    letterSlots.value.push({
      value: '',
      status: 'empty'
    })
    pendingMoveToNext.value = setTimeout(() => {
      currentLetterIndex.value = index + 1
      nextTick(() => {
        const nextInput = inputRefs.value[index + 1]
        if (nextInput) {
          nextInput.value = ''
          nextInput.focus()
        }
      })
      pendingMoveToNext.value = null
    }, isMobile ? 80 : 20)
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
      // 非辅助模式：删除当前框后，如果后面还有空框，删除最后一个空框
      if (!props.assistedMode && letterSlots.value.length > 1) {
        const lastSlot = letterSlots.value[letterSlots.value.length - 1]
        if (!lastSlot.value) {
          letterSlots.value.pop()
        }
      }
      const answer = currentAnswer.value
      emit('change', answer)
      emit('update:letters', answer)
    } else if (index > 0) {
      currentLetterIndex.value = index - 1
      letterSlots.value[index - 1].value = ''
      letterSlots.value[index - 1].status = 'empty'
      // 非辅助模式：删除前一个框的内容后，删除当前空框
      if (!props.assistedMode && letterSlots.value.length > 1) {
        letterSlots.value.pop()
      }
      nextTick(() => {
        const prevInput = inputRefs.value[index - 1]
        if (prevInput) {
          prevInput.value = ''
          prevInput.focus()
        }
        setTimeout(() => { handledByKeydown.value = false }, 50)
      })
      const answer = currentAnswer.value
      emit('change', answer)
      emit('update:letters', answer)
      return
    }
    
    setTimeout(() => { handledByKeydown.value = false }, 50)
  } else if (event.key === 'Enter') {
    // 非辅助模式：Enter 提交答案（至少输入了一个字母）
    // 辅助模式：所有框填满才能提交
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
  getValue: () => currentAnswer.value,
  setValue: (value) => {
    if (!value || typeof value !== 'string') return
    if (letterSlots.value.length === 0) {
      nextTick(() => {
        if (letterSlots.value.length > 0) {
          setValueInternal(value)
        }
      })
      return
    }
    setValueInternal(value)
  },
  isFilled: () => isAllFilled.value,
  focus: () => inputRefs.value[0]?.focus(),
  // 显示答案对比结果（用于非辅助模式提交后）
  showResult: () => {
    isSubmitted.value = true
    const wordLetters = props.word.toLowerCase().split('')
    const wordLength = wordLetters.length
    
    // 移除最后一个空字母框（如果有）
    if (letterSlots.value.length > 0 && !letterSlots.value[letterSlots.value.length - 1].value) {
      letterSlots.value.pop()
    }
    
    // 如果输入的字母数量少于单词长度，补充字母框（显示正确答案，灰色+红框）
    while (letterSlots.value.length < wordLength) {
      const correctLetter = wordLetters[letterSlots.value.length]
      letterSlots.value.push({
        value: correctLetter, // 显示正确答案字母
        status: 'missing' // 未输入的字母框使用 missing 状态（灰色字母+红框）
      })
    }
    
    // 逐个比较用户输入和正确答案
    letterSlots.value.forEach((slot, i) => {
      // 跳过已经标记为 missing 的字母框
      if (slot.status === 'missing') return
      
      if (slot.value) {
        const correctLetter = wordLetters[i]?.toLowerCase()
        slot.status = slot.value === correctLetter ? 'correct' : 'wrong'
      }
    })
  }
})

// 内部设置值的方法
function setValueInternal(value) {
  if (!value) return
  const letters = value.toLowerCase().split('').filter(l => /^[a-z]$/.test(l))
  
  if (props.assistedMode) {
    // 辅助模式：按单词长度填充
    if (letterSlots.value.length === 0) return
    letters.forEach((letter, i) => {
      if (i < letterSlots.value.length) {
        letterSlots.value[i].value = letter
        const correctLetter = props.word[i]?.toLowerCase()
        letterSlots.value[i].status = letter === correctLetter ? 'correct' : 'wrong'
        if (inputRefs.value[i]) {
          inputRefs.value[i].value = letter
        }
      }
    })
    // 聚焦到下一个空位
    const nextEmptyIndex = letterSlots.value.findIndex(slot => !slot.value)
    if (nextEmptyIndex !== -1) {
      currentLetterIndex.value = nextEmptyIndex
      nextTick(() => {
        inputRefs.value[nextEmptyIndex]?.focus()
      })
    } else {
      currentLetterIndex.value = letterSlots.value.length - 1
    }
  } else {
    // 非辅助模式：动态创建字母框
    letterSlots.value = letters.map(letter => ({
      value: letter,
      status: 'filled'
    }))
    // 添加一个空框用于继续输入
    letterSlots.value.push({
      value: '',
      status: 'empty'
    })
    currentLetterIndex.value = letterSlots.value.length - 1
    nextTick(() => {
      inputRefs.value[currentLetterIndex.value]?.focus()
    })
  }
  emit('change', currentAnswer.value)
}
</script>

<style lang="scss" scoped>
.letter-input-container {
  .letter-slots {
    display: flex;
    justify-content: center;
    align-items: center;
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

      &.slot-missing {
        background: var(--error-light, #fee2e2);
        border-color: var(--error);

        .letter-input {
          color: var(--charcoal-400); // 灰色显示正确答案
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
  .letter-input-container .letter-slots {
    .letter-slot {
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
}
</style>
