let holders = 0
let previousOverflow = ''
/** 多个弹层共享锁，防止关闭用户卡片后背景仍无法滚动。 */
export function lockBodyScroll(): () => void {
  if (holders === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  holders += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders === 0) document.body.style.overflow = previousOverflow
  }
}
