import { useCallback, useRef } from 'react'

/**
 * 返回引用恒定、内部实现始终是最新一次渲染那份的回调。
 *
 * 流式输出期间 setTurns 每帧触发一次重渲染，若把普通函数声明直接传给子组件，
 * 每帧都是新引用，React.memo 全部失效，整棵树（侧栏 / 输入区 / 消息列表）跟着重绘。
 * 用 useCallback 记忆化又会把 state 定在首帧。这里用 ref 转发当次实现，
 * 两个问题一起解决：外部看到的引用不变，调用时拿到的是最新闭包。
 */
export function useEventCallback<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result {
  const ref = useRef(handler)
  // 渲染期赋值：子组件在同一次渲染里同步调用时也能拿到本次实现。
  ref.current = handler
  return useCallback((...args: Args) => ref.current(...args), [])
}
