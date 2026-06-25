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
export function circleCircumference(diameter) {
    return PI * diameter;
}
/**
 * 圆面积
 */
export function circleArea(diameter) {
    return PI * (diameter / 2) ** 2;
}
//# sourceMappingURL=math-utils.js.map