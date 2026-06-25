# 2023 CSP-J1 入门级 C++ 语言试题：答案详解与考点权重

# 一、单项选择题

## 1. 答案：B

**考点与权重：** const-keyword: 80%, data-type: 20%

**详细解析：**

`const` 用于声明常量或修饰变量，使其值在初始化后不能再被修改。`unsigned` 表示无符号类型，`static` 表示静态存储或静态成员，`mutable` 常用于允许类成员在 `const` 对象中被修改。


## 2. 答案：D

**考点与权重：** base-conversion: 80%, arithmetic-operation: 20%

**详细解析：**

按八进制逐位相加：$12345670_8+07654321_8=22222211_8$。也可以转成十进制后再转回八进制，结果相同。


## 3. 答案：A

**考点与权重：** union: 80%, struct-basic: 20%

**详细解析：**

`data` 是一个 `union Data` 类型的变量，访问其成员应使用点运算符，所以修改 `value` 成员应写作 `data.value = 3.14;`。


## 4. 答案：A

**考点与权重：** linked-list: 80%, linear-data-structures: 20%

**详细解析：**

要把新节点插到链表头部，需要先创建节点并赋值，再让新节点的 `next` 指向原来的 `head`，最后把 `head` 更新为新节点。A 正好完成了这三步。


## 5. 答案：C

**考点与权重：** tree-basic: 70%, counting-principle: 30%

**详细解析：**

高度为 $h$ 的三叉树最多有 $1+3+3^{2}+\cdots+3^{h-1}=\frac{3^{h}-1}{2}$ 个节点。高度为 7 时最多 $1093$ 个节点，不足 2023；高度为 8 时最多 $3280$ 个节点，可以容纳 2023 个节点，所以高度至少为 8。


## 6. 答案：B

**考点与权重：** counting-principle: 70%, permutation-combination: 19%, enumeration: 11%

**详细解析：**

选择的两个时间段之间至少隔两个空闲段，即编号差至少为 3。选 1 个时间段有 7 种；选 2 个时间段有 10 种；选 3 个时间段只有 `{1,4,7}` 这一种。总数为 $7+10+1=18$。


## 7. 答案：C

**考点与权重：** high-precision: 70%, basic-algorithms: 20%, arithmetic-operation: 10%

**详细解析：**

高精度乘法的时间不仅与较长整数的位数有关，通常还与两个参与运算的整数位数都有关。A、B、D 都是高精度运算的常见描述，因此错误的是 C。


## 8. 答案：A

**考点与权重：** stack: 80%, code-tracing: 20%

**详细解析：**

按后缀表达式从左到右用栈计算：`2 3 +` 得到 `(2+3)`，`6 ... -` 得到 `6-(2+3)`；`8 2 /` 得到 `8/2`，再与 3 相加得到 `3+8/2`；随后两部分相乘、平方、再加 3，所以中缀表达式为 `((6 - (2 + 3)) * (3 + 8 / 2)) ^ 2 + 3`。


## 9. 答案：D

**考点与权重：** base-conversion: 80%, arithmetic-operation: 20%

**详细解析：**

$101010_2=42$，$166_8=1\times64+6\times8+6=118$，两者相加为 $160$。$160$ 的十六进制表示为 $A0_{16}$。


## 10. 答案：A

**考点与权重：** huffman-tree: 80%, greedy: 20%

**详细解析：**

哈夫曼编码中频率越高，编码通常越短。频率为 45% 的 `f` 应得到最短编码，频率较小的 `a`、`b` 应得到较长编码。选项 A 中 `f` 的编码为 `0`，`a`、`b` 编码长度为 4，且整体满足前缀编码要求。


## 11. 答案：A

**考点与权重：** binary-tree: 70%, tree-traversal: 30%

**详细解析：**

前序遍历第一个字符 `A` 是根。中序遍历中 `A` 左侧为 `DEB`，右侧为 `CFG`。左子树后序为 `EDB`，右子树后序为 `FGC`，最后访问根 `A`，所以后序遍历为 `EDBFGCA`。


## 12. 答案：B

**考点与权重：** topological-sort: 70%, graph-theory: 30%

**详细解析：**

拓扑排序要求每条有向边的起点都排在终点之前。边 `(1,2)`、`(1,3)` 要求 1 在 2、3 前；边 `(2,4)`、`(3,4)` 要求 2、3 在 4 前。选项 B `1,2,3,4` 满足所有要求。


## 13. 答案：B

**考点与权重：** bit-byte: 80%, arithmetic-operation: 20%

**详细解析：**

bit 是比特，是计算机中最小的数据单位；1 byte 等于 8 bit，word 和 kilobyte 都更大。因此容量最小的是比特。


## 14. 答案：A

**考点与权重：** permutation-combination: 70%, inclusion-exclusion: 30%

**详细解析：**

从 22 人中选 3 人共有 $C(22,3)=1540$ 种。减去全是男生的情况 $C(10,3)=120$ 种，得到至少包含 1 个女生的方案数为 $1540-120=1420$。


## 15. 答案：D

**考点与权重：** language-basics: 70%, computer-basic: 30%

**详细解析：**

Linux、Windows、Android 都是操作系统；HTML 是超文本标记语言，不是操作系统。


# 二、阅读程序

## 16. 答案：√

**考点与权重：** perfect-square: 70%, loop-tracing: 30%

**详细解析：**

该函数使用海伦公式计算三角形面积。输入 `2 2 2` 时，半周长 $s=3$，面积为 $\sqrt{3\times1\times1\times1}=\sqrt3\approx1.7321$，保留四位小数后为 `1.7321`。


## 17. 答案：√

**考点与权重：** arithmetic-operation: 70%, counting-principle: 30%

**详细解析：**

乘法满足交换律，`(s-b)*(s-c)` 与 `(s-c)*(s-b)` 的值相同，因此不会影响程序运行结果。


## 18. 答案：×

**考点与权重：** language-basics: 70%, computer-basic: 30%

**详细解析：**

程序设置了 `fixed` 和 `precision(4)`，正常数值会输出四位小数。但输入的三个正整数不一定能构成三角形，海伦公式中可能出现负数开方，输出可能不是普通的四位小数形式。


## 19. 答案：A

**考点与权重：** arithmetic-operation: 70%, counting-principle: 30%

**详细解析：**

输入 `3 4 5` 时是直角三角形，面积为 $3\times4/2=6$，程序按固定四位小数输出 `6.0000`。


## 20. 答案：B

**考点与权重：** arithmetic-operation: 70%, counting-principle: 30%

**详细解析：**

输入 `5 12 13` 时也是直角三角形，面积为 $5\times12/2=30$，因此输出 `30.0000`。


## 21. 答案：√

**考点与权重：** lcs: 70%, dynamic-programming: 30%

**详细解析：**

`f` 函数计算两个字符串的最长公共子序列长度。公共子序列长度不可能超过任意一个字符串的长度，因此返回值一定小于等于 `min(n,m)`。


## 22. 答案：×

**考点与权重：** lcs: 70%, dynamic-programming: 30%

**详细解析：**

`f` 中状态转移允许从 `v[i-1][j]` 和 `v[i][j-1]` 继承结果，这是最长公共子序列的做法，不是最长公共子串。子串要求连续，而子序列不要求连续。


## 23. 答案：√

**考点与权重：** string-basic: 70%, dynamic-programming: 19%, function-recursion-basic: 11%

**详细解析：**

若两个输入字符串完全相同，则长度相同，而且 `x+x` 中一定可以找到一个与 `y` 相同的子序列，所以 `f(x+x,y)==y.size()` 成立，`g` 返回 `true`。


## 24. 答案：D

**考点与权重：** array-indexing: 70%, code-tracing: 30%

**详细解析：**

数组 `v` 的大小是 `(m+1)×(n+1)`。如果把 `v[m][n]` 改为 `v[n][m]`，当 `n>m` 或 `m>n` 时可能访问越界，因此程序可能非正常退出。


## 25. 答案：B

**考点与权重：** logical-operator: 80%, expression-evaluation: 20%

**详细解析：**

输入 `csp-j p-jcs` 时，`x+x` 为 `csp-jcsp-j`，其中可以按顺序取出 `p-jcs` 作为子序列，因此 `g` 返回 `true`。`cout` 输出布尔值时默认输出 `1`。


## 26. 答案：D

**考点与权重：** string-basic: 70%, dynamic-programming: 19%, simulation: 11%

**详细解析：**

输入 `csppsc spsccp` 时，`x+x` 为 `csppsccsppsc`，可以按顺序取出 `spsccp` 作为子序列，因此 `g` 返回 `true`，输出为 `1`。


## 27. 答案：√

**考点与权重：** perfect-square: 70%, loop-tracing: 30%

**详细解析：**

当 `n` 为正整数时，`solve2` 枚举 `1` 到 `sqrt(n)` 的所有可能因子。如果 `i` 是因子，就把 `$i^{2}$` 和对应因子 `(n/i)^2` 加入答案，因此作用是计算所有因子的平方和。


## 28. 答案：√

**考点与权重：** condition-simulation: 70%, code-tracing: 30%

**详细解析：**

当 `i*i==n` 时，`i` 和 `n/i` 是同一个因子。第 13-14 行单独处理这种情况，可以避免平方根因子在第 16 行被加两次。


## 29. 答案：√

**考点与权重：** primality-test: 70%, number-theory: 30%

**详细解析：**

若 `n` 是质数，它只有两个正因子 1 和 n。因此 `solve2(n)` 返回 $1^{2}+n^{2}=n^{2}+1$。


## 30. 答案：B

**考点与权重：** primality-test: 70%, number-theory: 30%

**详细解析：**

若输入的 `n` 为质数 `p` 的平方，即 $n=p^{2}$，那么 `n` 的正因子是 $1,p,p^{2}$。平方和为 $1+p^{2}+p^{4}$。又因为 $n=p^{2}$，所以结果也可写作 $n^{2}+n+1$。


## 31. 答案：D

**考点与权重：** arithmetic-operation: 70%, counting-principle: 30%

**详细解析：**

第一项是 `solve2($n^{2}$)`，第二项是 `solve2(n)` 的平方。通常第二项会包含更多交叉乘积，因此第一项减第二项不大于 0；当 `n=1` 时两项都为 1，差值为 0，所以不一定小于 0。


## 32. 答案：C

**考点与权重：** function-recursion-basic: 70%, enumeration: 16%, simulation: 14%

**详细解析：**

输入 `5` 时，`solve1(5)=25`，`solve2(25)=$1^{2}$+$5^{2}$+$25^{2}$=651`；`solve2(5)=$1^{2}$+$5^{2}$=26`，`solve1(26)=676`。所以输出为 `651 676`。


# 三、完善程序

## 33. 答案：B

**考点与权重：** binary-search: 70%, array-basic: 19%, arithmetic-operation: 11%

**详细解析：**

原数列公差为 1，若没有缺失，则第 `mid` 个元素应为 `nums[0]+mid`。所以判断式应写成 `nums[mid] == mid + nums[0]`，① 填 `nums[0]`。


## 34. 答案：A

**考点与权重：** binary-search: 70%, array-basic: 17%, conditional-branch: 13%

**详细解析：**

如果 `nums[mid] == nums[0]+mid`，说明从开头到 `mid` 位置仍然连续，缺失元素只可能在右侧，因此应令 `left = mid + 1`。


## 35. 答案：C

**考点与权重：** binary-search: 70%, array-basic: 17%, conditional-branch: 13%

**详细解析：**

如果 `nums[mid] != nums[0]+mid`，说明缺失位置已经出现在 `mid` 或其左侧，需要保留 `mid`，因此应令 `right = mid`。


## 36. 答案：A

**考点与权重：** pointer: 80%, assignment-statement: 20%

**详细解析：**

循环结束时，`left` 指向第一个不满足连续关系的位置，此处缺失的数应为 `nums[0]+left`，所以 ④ 填 `left + nums[0]`。


## 37. 答案：D

**考点与权重：** array-indexing: 70%, code-tracing: 30%

**详细解析：**

当缺失的是第一个或最后一个元素时，输入数组本身仍然连续，函数会返回当前数组最后一个元素 `nums[n-1]`。主函数用它作为“不需要输出缺失元素”的标记，所以 ⑤ 填 `nums[n-1]`。


## 38. 答案：A

**考点与权重：** dynamic-programming: 70%, string-basic: 17%, conditional-branch: 13%

**详细解析：**

当第一个字符串为空时，要把它变成 `str2` 的前 `j` 个字符，需要插入 `j` 次，因此 `dp[0][j]=j`。


## 39. 答案：B

**考点与权重：** dynamic-programming: 70%, string-basic: 17%, conditional-branch: 13%

**详细解析：**

当第二个字符串为空时，要把 `str1` 的前 `i` 个字符变为空串，需要删除 `i` 次，因此 `dp[i][0]=i`。


## 40. 答案：A

**考点与权重：** string-basic: 70%, dynamic-programming: 20%, array-basic: 10%

**详细解析：**

状态 `dp[i][j]` 比较的是 `str1` 的第 `i` 个字符和 `str2` 的第 `j` 个字符，但数组下标从 0 开始，所以应判断 `str1[i-1] == str2[j-1]`。


## 41. 答案：B

**考点与权重：** dynamic-programming: 70%, string-basic: 19%, conditional-branch: 11%

**详细解析：**

如果当前两个字符相同，不需要额外操作，直接继承 `dp[i-1][j-1]`，所以 ④ 填 `dp[i - 1][j - 1]`。


## 42. 答案：C

**考点与权重：** dynamic-programming: 70%, string-basic: 17%, ad-hoc: 13%

**详细解析：**

三种操作分别对应插入 `dp[i][j-1]`、删除 `dp[i-1][j]`、替换 `dp[i-1][j-1]`。外层已经统一加 1，所以 ⑤ 处应填 `dp[i - 1][j - 1]`。
