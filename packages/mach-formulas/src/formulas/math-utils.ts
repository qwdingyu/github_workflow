/**
 * 数学工具函数
 * 来源：文件6《各种机械加工工时计算软件》
 */

/**
 * π 常数
 */
export const PI = Math.PI;

/**
 * 圆周率相关计算
 */
export function circleCircumference(diameter: number): number {
  return PI * diameter;
}

/**
 * 圆面积
 */
export function circleArea(diameter: number): number {
  return PI * (diameter / 2) ** 2;
}
