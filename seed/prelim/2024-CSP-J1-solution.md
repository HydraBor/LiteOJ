# 2024 CSP-J1 入门级 C++ 语言试题：答案详解与考点权重

# 一、单项选择题

## 1. 答案：C

**考点与权重：** data-type: 70%, signed-integer: 30%

**详细解析：**

32 位有符号 `int` 的范围通常是 $-2^{31}$ 到 $2^{31}-1$，也就是 `-2147483648 ~ +2147483647`。

---

## 2. 答案：A

**考点与权重：** base-conversion: 80%, arithmetic-operation: 20%

**详细解析：**

$14_8=12$，$1010_2=10$，$D_{16}=13$，$1101_2=13$。所以 $(12-10)\times13-13=26-13=13$。

---

## 3. 答案：B

**考点与权重：** permutation-combination: 80%, counting-principle: 20%

**详细解析：**

4 人来自 3 个部门且每个部门至少 1 人，只能是某一部门选 2 人，另外两个部门各选 1 人。若 A 部门选 2 人，有 $C(4,2)C(3,1)C(3,1)=54$ 种；若 B 或 C 部门选 2 人，各有 $C(3,2)C(4,1)C(3,1)=36$ 种，共 $54+36+36=126$。

---

## 4. 答案：D

**考点与权重：** gray-code: 80%, binary-representation: 20%

**详细解析：**

标准二进制格雷码相邻两项只改变 1 位。数字 0 到 7 对应的 4 位格雷码依次为 `0000, 0001, 0011, 0010, 0110, 0111, 0101, 0100`，对应选项 D。

---

## 5. 答案：D

**考点与权重：** bit-byte: 80%, arithmetic-operation: 20%

**详细解析：**

$1\text{MB}=1024\text{KB}=1024\times1024$ 字节，1 字节等于 8 bit，因此 $1\text{MB}=1024\times1024\times8=8388608$ bit。

---

## 6. 答案：C

**考点与权重：** data-type: 80%, struct-basic: 20%

**详细解析：**

`int`、`float`、`char` 都是 C++ 基本数据类型；`struct` 用来定义结构体类型，不属于基本数据类型。

---

## 7. 答案：D

**考点与权重：** loop-structure: 80%, language-basics: 20%

**详细解析：**

C++ 中常见循环语句有 `for`、`while`、`do-while`，没有 `repeat-until` 这种循环语句。

---

## 8. 答案：B

**考点与权重：** character-encoding: 70%, conditional-branch: 30%

**详细解析：**

字符 `'a'` 往后移动 13 个位置得到 `'n'`，所以 `(char)('a'+13)` 的结果是 `'n'`。

---

## 9. 答案：B

**考点与权重：** binary-search: 80%, loop-tracing: 20%

**详细解析：**

二分查找每比较一次大约把范围缩小一半。因为 $2^{10}=1024\ge1000$，所以最多比较 10 次。

---

## 10. 答案：A

**考点与权重：** language-basics: 70%, computer-basic: 30%

**详细解析：**

Linux、Windows、macOS 都是操作系统；Notepad 是记事本应用程序，不是操作系统。

---

## 11. 答案：B

**考点与权重：** graph-degree: 80%, graph-edge-count: 20%

**详细解析：**

无向图中每条边会给两个端点的度数各贡献 1，所以所有顶点的度数之和等于边数的两倍。

---

## 12. 答案：A

**考点与权重：** binary-tree: 70%, tree-traversal: 30%

**详细解析：**

前序遍历第一个结点 A 是根；中序遍历中 A 左侧为左子树 `[D,B,E]`，右侧为右子树 `[F,C,G]`。左子树后序为 `[D,E,B]`，右子树后序为 `[F,G,C]`，最后访问根 A，因此后序遍历为 `[D,E,B,F,G,C,A]`。

---

## 13. 答案：D

**考点与权重：** stack: 80%, code-tracing: 20%

**详细解析：**

A 可以全部入栈后再依次出栈；B、C 也能通过合适的入栈出栈顺序得到。D 中输出 `1,3,5` 后，若要接着输出 2，此时 4 已经压在 2 的上方，不可能先弹出 2，所以 D 不可能。

---

## 14. 答案：A

**考点与权重：** permutation-combination: 80%, counting-principle: 20%

**详细解析：**

把 3 个女生看作一个整体，则共有 5 个男生加 1 个女生整体，即 6 个对象排列，有 $6!$ 种；女生内部还有 $3!$ 种排列，所以总数为 $6!\times3!=720\times6=4320$。

---

## 15. 答案：B

**考点与权重：** compiler: 80%, computer-basic: 20%

**详细解析：**

编译器的主要作用是把高级语言源代码翻译成目标代码或机器代码，使程序能够被计算机执行。

---

# 二、阅读程序

## 16. 答案：√

**考点与权重：** primality-test: 70%, number-theory: 30%

**详细解析：**

10 以内的素数是 2、3、5、7，共 4 个，和为 $2+3+5+7=17$，所以输出 `4 17`。

---

## 17. 答案：×

**考点与权重：** primality-test: 70%, number-theory: 30%

**详细解析：**

把判断上界改为 `i <= n / 2` 仍然可以判断素数，只是效率更低。20 以内素数有 2、3、5、7、11、13、17、19，共 8 个，不会变成 6。

---

## 18. 答案：√

**考点与权重：** primality-test: 70%, number-theory: 30%

**详细解析：**

`sumPrimes` 从 2 枚举到 `n`，只在 `isPrime(i)` 为真时把 `i` 加到 `sum` 中，因此计算的是 2 到 n 之间所有素数的和。

---

## 19. 答案：B

**考点与权重：** primality-test: 70%, number-theory: 30%

**详细解析：**

50 以内的素数为 2、3、5、7、11、13、17、19、23、29、31、37、41、43、47，它们的和为 328。

---

## 20. 答案：A

**考点与权重：** primality-test: 70%, number-theory: 30%

**详细解析：**

若循环改为 `i <= n`，当检测任意大于 1 的数 `n` 时，循环会运行到 `i=n`，此时 `n % i == 0`，函数会返回 `false`。这样所有大于 1 的数都会被判断为非素数，无法正确计算素数个数及其和。

---

## 21. 答案：√

**考点与权重：** dynamic-programming: 70%, array-basic: 19%, simulation: 11%

**详细解析：**

对 `{10,15,20}`，有 `dp[1]=10`，`dp[2]=15`，`dp[3]=min(15,10)+20=30`，最后返回 `min(dp[3],dp[2])=15`。

---

## 22. 答案：×

**考点与权重：** array-indexing: 70%, code-tracing: 30%

**详细解析：**

把 `dp[i-1]` 改成 `dp[i-3]` 后，语法上仍然可以通过编译，不一定产生编译错误。真正的问题是当 `i` 较小时可能访问非法下标，造成运行时错误或未定义行为。

---

## 23. 答案：×

**考点与权重：** dynamic-programming: 70%, array-basic: 19%, simulation: 11%

**详细解析：**

程序计算的是按规则到达顶部的最小代价，并不总是数组最小值。例如 `{10,15,20}` 的输出是 15，而数组最小值是 10。

---

## 24. 答案：A

**考点与权重：** recurrence-sequence: 80%, arithmetic-operation: 20%

**详细解析：**

按递推计算，最终得到 `dp[10]=6`，`dp[9]=104`，返回 `min(dp[10],dp[9])=6`。

---

## 25. 答案：B

**考点与权重：** dynamic-programming: 70%, array-basic: 17%, simulation: 13%

**详细解析：**

对 `{10,15,30,5,5,10,20}` 依次计算可得 `dp[1]=10`，`dp[2]=15`，`dp[3]=40`，`dp[4]=20`，`dp[5]=25`，`dp[6]=30`，`dp[7]=45`，最后返回 `min(45,30)=30`。

---

## 26. 答案：A

**考点与权重：** recurrence-sequence: 80%, arithmetic-operation: 20%

**详细解析：**

修改后递推为 `dp[i]=dp[i-1]+cost[i-2]`。当 `cost={5,10,15}` 时，`dp[1]=5`，`dp[2]=5+5=10`，`dp[3]=10+10=20`，最后返回 `min(20,10)=10`。

---

## 27. 答案：×

**考点与权重：** recursion: 70%, function-recursion-basic: 17%, simulation: 13%

**详细解析：**

`customFunction(2,3)=2+customFunction(2,2)=2+2+2+2=8`。64 是主函数中 `pow(result,2)` 的最终输出，不是 `customFunction(2,3)` 的返回值。

---

## 28. 答案：√

**考点与权重：** recursive-tracing: 70%, recursion: 30%

**详细解析：**

递归终止条件是 `b==0`。当 `b` 为负数时，每次调用都会变成 `b-1`，离 0 越来越远，因此会陷入无限递归。

---

## 29. 答案：√

**考点与权重：** recursion: 70%, code-tracing: 30%

**详细解析：**

当 `b>=0` 时，每次递归都会让 `b` 减 1，直到 `b==0` 结束，所以递归次数随 `b` 增大而增加，运行时间也变长。

---

## 30. 答案：B

**考点与权重：** recursion: 70%, function-recursion-basic: 17%, arithmetic-operation: 13%

**详细解析：**

`customFunction(5,4)` 会返回 5 加 5 共 5 次，即 $5\times(4+1)=25$。

---

## 31. 答案：C

**考点与权重：** recursion: 70%, function-recursion-basic: 14%, stl: 11%, arithmetic-operation: 5%

**详细解析：**

输入 `x=3,y=3` 时，`customFunction(3,3)=3+3+3+3=12`，主函数输出 $12^{2}=144$。

---

## 32. 答案：D

**考点与权重：** recursion: 70%, function-recursion-basic: 17%, arithmetic-operation: 13%

**详细解析：**

修改后 `customFunction(3,3)=3+customFunction(2,2)=3+2+customFunction(1,1)=3+2+1+customFunction(0,0)=6`，最终输出 $6^{2}=36$。

---

# 三、完善程序

## 33. 答案：A

**考点与权重：** perfect-square: 70%, loop-tracing: 30%

**详细解析：**

判断正整数是否为完全平方数，需要从可能的正整数平方根开始枚举，最小候选值应为 1，所以 ① 为 `1`。

---

## 34. 答案：B

**考点与权重：** perfect-square: 70%, loop-tracing: 30%

**详细解析：**

若 `num` 是完全平方数，其平方根不会超过 $\lfloor\sqrt{num}\rfloor$，因此枚举上界应设为 `(int)floor(sqrt(num))`。

---

## 35. 答案：D

**考点与权重：** condition-simulation: 70%, code-tracing: 30%

**详细解析：**

判断 `num` 是否等于某个整数的平方，应使用比较运算 `num == i * i`。选项 C 是赋值语句，不是判断相等。

---

## 36. 答案：C

**考点与权重：** perfect-square: 70%, loop-tracing: 30%

**详细解析：**

当发现 `num == i * i` 时，说明 `num` 是完全平方数，应返回 `true`。官方答案给 C；由于选项 A 是赋值表达式 `num = 2 * i`，在本题进入该分支时也会得到非零值并被当作真，因此 A 也算正确，但更规范的写法是 C。

---

## 37. 答案：D

**考点与权重：** perfect-square: 70%, loop-tracing: 30%

**详细解析：**

如果循环结束仍未找到满足 `num == i * i` 的整数 `i`，说明它不是完全平方数，应返回 `false`。

---

## 38. 答案：B

**考点与权重：** recursion: 70%, recursive-tracing: 30%

**详细解析：**

汉诺塔递归的基本情况是只剩 1 个盘子，此时直接从源柱移动到目标柱即可，所以 ① 为 `1`。

---

## 39. 答案：B

**考点与权重：** recursion: 70%, function-recursion-basic: 19%, simulation: 11%

**详细解析：**

当只有 1 个盘子时，应直接执行 `move(src, tgt)`，即从源柱移动到目标柱，所以 ② 为 `src, tgt`。

---

## 40. 答案：B

**考点与权重：** recursion: 70%, function-recursion-basic: 20%, simulation: 10%

**详细解析：**

移动 `i` 个盘子时，第一步要先把上面的 `i-1` 个盘子从 `src` 借助 `tgt` 移到 `tmp`，所以调用应为 `dfs(i - 1, src, tgt, tmp)`。

---

## 41. 答案：B

**考点与权重：** recursion: 70%, function-recursion-basic: 20%, simulation: 10%

**详细解析：**

移动最大盘到 `tgt` 后，需要把 `i-1` 个盘子从 `tmp` 借助 `src` 移到 `tgt`，所以 ④ 为 `tmp, src, tgt`。

---

## 42. 答案：C

**考点与权重：** recursion: 70%, code-tracing: 30%

**详细解析：**

第二次递归移动的仍然是上面的 `i-1` 个盘子，因此 ⑤ 应填 `i - 1`。

---
