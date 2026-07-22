[TOC]

# STL

## swap:

容器的交换是O(1)的

eg. `set.swap()` , `vector.swap()`

vector 的清空用swap 和clear各有优势，clear可以保存capasity

## 双端队列deque:

deque\<typename T> q

q.front() 返回队首元素
q.back() 返回队尾元素
q.push_back() 在队尾插入元素
q.pop_back() 弹出队尾元素
q.push_front() 在队首插入元素
q.pop_front() 弹出队首元素
q.insert() 在指定位置前插入元素（传入迭代器和元素）
q.erase() 删除指定位置的元素（**传入迭代器**）
q.empty() 队列是否为空
q.size() 返回队列中元素的数量

## 优先队列priority_queue:

empty()：若优先队列为空，则返回真。
pop()：队头出队。
push()：入队。
top()：取堆顶（队头），返回优先队列中优先级最高的元素。
size()：返回优先队列中元素的个数。

### 操作符重载为小根堆

```c++
struct ty{
    int x;
    bool operator<(const ty&u)const{
        return x>u.x;
    }
};
```



## set:

set默认升序排序，也可以自定义排序
set 插入元素不会保留两个相同元素
set 自定义排序和sort类似 set<int,cmp> se;

### 重载运算符

```c++
struct cmp{
	bool operator()(const int&u,const int&v)const{
		if(abs(u-v)<=k) return false;
		else return u<v;	
	}
};
```



insert()//插入元素
count()//判断容器中是否存在某个元素
size()//返回容器的尺寸，也可以元素的个数
erase()//删除集合中某个元素
clear()//清空集合
empty()//判断是否为空
begin()//返回第一个节点的迭代器
end()//返回最后一个节点加1的迭代器
rbegin()//反向迭代器
rend()//反向迭代器

find()查找等于某个值的元素的迭代器

**lower_bound()//二分查找第一个不小于某个值的元素的迭代器**
**swap()//交换两个集合的变量**

**set.lower_bound(num)才是O(logn),set.swap()才是O(1)**

se.extract(key) 删除数值等于key的元素

### 多重集multiset:

**multiset.erase(x);如果x是迭代器只删除一个元素，否则删除全部等于x的元素**

只删除一个元素的写法:

**multiset.erase(multiset.find(x))**

**multiset.extract(x)** 比erase高效

## next_permutation

全排列

```c++
int a[] = {1,2,3,4,5,6,7,8};
do{
    for(int i = 0;i<8;++i){
        cout<<a[i]<<" ";
    }
    cout<<endl;
}while(next_permutation(a,a+8));
```

**permutation传进去的数组必须是升序**



## __builtin类

__builtin_popcount(x)  返回二进制数中1的个数

__builtin_ctz(x);        // 返回最低位 1 的 0-based 索引，如果 x==0 行为未定义



## reduce

支持**并行**策略求数组和(**浮点数**时**不要**使用并行策略)

reduce 可能会改变操作顺序，它仅适用于**满足交换律与结合律的操作**

需要 **#include\<execution>**

```cpp
int sum = reduce(std::execution::par, numbers.begin(), numbers.end());
```

支持自定义初始值

```cpp
std::vector<int> v = {1, 2, 3, 4, 5};
int sum = std::reduce(v.begin(), v.end(), 10);  // 10 + 1 + 2 + ... + 5
```

支持lamda自定义操作

```cpp
int product = std::reduce(std::execution::par, v.begin(), v.end(), 1, [](int a, int b) {
    return a * b;
});//乘法满足交换律和结合律所以可以支持并行
std::cout << "Product = " << product << std::endl;  // 输出 120 v={1,2,3,4,5}

//计算平方和，不满足交换律和结合律，不可以并行计算
int sum_of_squares = reduce(v.begin(),v.end(), 0, [](int a, int b) {
	return a + b * b;
});
```



## complex(复数类)

创建一个复数

```cpp
std::complex<double> c1(3.0, 4.0);
```

常用函数

`std::abs(c)`: 获取复数的模。

`std::arg(c)`: 获取复数的幅角,弧度表示。

`std::norm(c)`: 获取复数的模的平方。

`std::conj(c)`: 获取复数的共轭。

`std::real(c)`: 获取复数的实部。

`std::imag(c)`: 获取复数的虚部。

`std::polar(m, theta)`: 将极坐标转换为复数。



## bitset

可以直接当bool数组用,在数据比较随机修改的时候性能不如bool数组,会有额外的开销

set(pos):将第pos位为 $1$

set():所有位置置 $1$

reset():所有位置置 $0$

count():返回 $1$ 的个数

```cpp
bitset<8> a(string("1100")), b(string("1010"));  
auto c = a & b; // 1000  
auto d = a | b; // 1110  
auto e = a ^ b; // 0110
支持&,|,^,<<,>>
```

`bitset<size_t>._Find_first();`  // **返回第一个 1 的下标**，若全 0 则返回 bs.size()

`b.flip(3)` :bitset b 对第3位取反

`b.set()` :全部置1,可以指定位置设1

`b.reset()` :全部置0，可以指定位置设0

`b.test(pos)` :检查第 `pos` 位是否为`1`,是`1` 返回 `true`

`b.any()`:检查bitset中是否有任意一位是1，如果全为0返回 `false`

`bitset<N>()` :默认构造函数，并且所有为初始化为0

## getline

```cpp
int n;cin>>n;
getchar();//把n的\n读掉
getline(cin,s)
```



## move

```cpp
string a = "Hello, world!";
string b = std::move(a);   // 调用 string(string&&)，“窃取” a 内部缓冲区
cout << "a.size()=" << a.size() << ", b.size()=" << b.size() << "\n";
```

b将拥有a的内部内存，a处于"move-from"状态，通常长度变为0，但仍保持有效，可析构

- 移动后，**不要再依赖被移动对象的内容，除非你给他重新赋值**

- **不要**对右值使用 std::move,例如

  ```cpp
  foo(std::move(string("abc")));  // string("abc") 本身就是右值
  ```




## nth_element

`std::nth_element(first,nth,last,comp)` 把区间 `[first,last)` **就地重排** , 使得 `nth` 指向得到元素变成整个区间被完全排序后应该在的位置.重排后`[first,nth)` 中的元素都不大于 `[nth,last)` 中的任意元素.(左右两边不保证有序) , 比较符号可以有`comp`重载

平均复杂度 $O(n)$

### 应用

**1.找中位数** 

```cpp
auto m = a.begin() + a.size()/2;
std::nth_element(a.begin(), m, a.end());
int median = *m;
```

**2.找top-k个元素(不保证有序)**

```cpp
std::nth_element(a.begin(), a.begin()+k, a.end(), std::greater<int>());
 // 现在 a[0..k-1] 是最大的 k 个元素（无序）,之后对前k个元素排序就可以有序了
```

**3.对大型/昂贵可移动对象：尽量避免频繁拷贝/交换，常见技巧是对索引或指针做 `nth_element`，或者使用 move-only 类型并确保移动成本可接受**

```cpp
std::vector<YourBig> data = ...;
std::vector<size_t> idx(data.size());
std::iota(idx.begin(), idx.end(), 0);
std::nth_element(idx.begin(), idx.begin()+k, idx.end(),
    [&](size_t i, size_t j){ return data[i] < data[j]; });// 对索引做选择
// idx[0..k-1] 是 top-k 的索引
```



# Trick

## 差分

```c++
for (int i = 1; i <= n; ++i){
        cin >> a[i];
        b[i] = a[i] - a[i - 1];
}
while (m--){
        int l, r, x;cin >> l >> r >> x;
        b[l] += x;         // l位置加x
        if (r<n) b[r+1]-=x; // 如果r+1在范围内，r+1位置减去x
}
```



## 枚举子集

从1-n枚举子集
```c++
for(int i=1;i<=n;i++){
        …..
       for(int j=(i-1)&i;j;j=(j-1)&i){//(i-1)&i会将i的最低位的1置0，从而得到子集
            ……
       }
}
```



### 枚举恰好有k个1的二进制数(Gosper's Hack)

比较简单的办法是DFS,但是由于递归效率可能有所降低,并且有一些不合法的情况,而采用Gosper's Hack 的时间复杂度是严格的 $O(C(N,E))$

本质就是 

1.抬起最低的1;

2.将腾出的其余1挤到最低端

3.合并，得到下一个组合

核心公式

```cpp
unsigned long long c = mask & -mask;      // 1. 取出 mask 中最右边的 1 及其低位部分
unsigned long long r = mask + c;           // 2. 将这段 “…01…1…0…0” 中最右的连续 1 进位产生翻转
unsigned long long next_mask = (((r ^ mask) >> 2) / c) | r;//本质是把除进位和原lowbit的1从第0位，从低到高放上去
```

枚举

```cpp
// E 总位宽，N 需置 1 的位数
unsigned int E, N;
...
// 1. 初始掩码：低 N 位全 1
unsigned long long mask = (1ULL << N) - 1;
// 2. 终止阈值
unsigned long long limit = (1ULL << E);

while (mask < limit) {
    // —— 在这里处理 mask —— //
    
    // Gosper’s Hack 生成下一个
    unsigned long long c = mask & -mask;
    unsigned long long r = mask + c;
    mask = (((r ^ mask) >> 2) / c) | r;
}
```









## 离散化

```c++
sort(v.begin(),v.end());
int m = v.erase(unique(v.begin(),v.end()),v.end())-v.begin();
auto find = [&](int num){
    return lower_bound(v.begin(),v.end(),num)-v.begin();
};
```



## 快速幂

```c++
constexpr int mod = 1e9+7;
i64 qp(i64 a,i64 b){
    i64 ans = 1;
    while(b){
        if(b&1) ans = (ans*a)%mod;
        a = (a*a)%mod;
        b>>=1;
    }
    return ans;
}
```



## 快速乘

```c++
using i64 = long long;
i64 fastmul(i64 a,i64 b,i64 c){//a,b是要乘的数，c是要取余的数 
    i64 res = 0;
    while(b){
        //将乘法运算转化为加法运算
        if(b&1){//判断奇数 
            res = (res+a)%c;
        }
        a = (a<<1)%c;
        b>>=1; 
    }
    return res%c;
}
```



## 快读快输出

```c++
//读入整型
template<typename T>inline void read(T &x){
    bool f=1;x=0;char ch=getchar();
    while(ch<'0'||ch>'9'){if(ch=='-') f=!f;ch=getchar();}
    while(ch>='0'&&ch<='9'){x=(x<<1)+(x<<3)+(ch^48);ch=getchar();}
    x=(f?x:-x);return;
}

//读入__int128
inline void read128(__int128 &x){
    bool f=1;x=0;char ch=getchar();
    while(ch<'0'||ch>'9'){if(ch=='-') f=!f;ch=getchar();}
    while(ch>='0'&&ch<='9'){x=(x<<1)+(x<<3)+(ch^48);ch=getchar();}
    x=(f?x:-x);return;
}

inline void print(__int128 x){
    if(x < 0){
        putchar('-');
        x = -x;
    }
    if(x > 9) print(x / 10);
    putchar(x % 10 + '0');
}
```





## 预处理阶乘和模逆

```c++
void precalc() {
    fac[0] = 1;
    for(int i = 1; i < MAXN; i++) fac[i] = (fac[i-1] * i) % mod;
    inv[MAXN-1] = qpow(fac[MAXN-1],mod-2); // 费马小定理计算模逆
    for(int i = MAXN-2; i >= 0; i--) inv[i] = (inv[i+1] * (i+1)) % mod;
}
```

求组合数 $C(n,m)=fac[n]*inv[n-m]\%mod*inv[m]\%mod$

如果 $n$ ,$m$ 较大的话,可以用一下方式求 $C(row,a)$

```cpp
for(int i = 0;i<a;++i){
    (col*=(row-i+mod)%mod)%=mod;
    (col*=qp((a-i+mod)%mod,mod-2))%=mod;
}
```



## 求逆序对:

冒泡排序次数等于逆序对个数

### 归并排序求逆序对:

```c++
i64 ans = 0;
void mergesort(int l,int r){
    if(l==r) return;
    int mid = l+r>>1;
    mergesort(l,mid);
    mergesort(mid+1,r);
    int i =l,st = l,j = mid+1;
    while(l<=mid&&j<=r){
        if(a[l]<=a[j]){
            temp[i++] = a[l++];
        }else{
            temp[i++] = a[j++],ans+=mid-l+1;
        }
    }
    while(l<=mid) temp[i++] = a[l++];
    while(j<=r) temp[i++] = a[j++];
    for(i = st;i<=r;i++) a[i] = temp[i];
    return;
}
```





### 树状数组求逆序对:

```c++
int tree[maxn];
inline int lowbit(int x){return x&(-x);}
//单点修改
inline void update(int x,int v){//x是要更新的地方,v数要更新的数值
    for(int i = x;i<=n;i+=lowbit(i)){
        tree[i]+=v; 
    }
}
//前缀区间和 
i64 sum(int x){
    i64 res = 0;
    for(int i =x;i>0;i-=lowbit(i)){
        res+=tree[i];
    }
    return res;
}

//区间[L,R]求和
i64 search(int L,int R){
    if(L>R) return 0;
    i64 ans = 0;
    for(int i = L-1;i;i-=lowbit(i)) ans-=tree[i];
    for(int i=R;i;i-=lowbit(i)) ans+=tree[i];
    return ans;         
}

//求逆序对
void solve(){
    for(int i = n;i>=1;--i){
        ans+=sum(a[i]);
        add(a[i],1);
    }
    cout<<ans<<"\n";
}
```



## 高精度

### 加

```c++
string add(string &a,string &b) {//倒序传入
    int n = a.size(), m = b.size();
    int L = max(n, m);
    string res;
    res.reserve(L + 1);
    
    int carry = 0;
    for (int i = 0; i < L; ++i) {
        int da = (i < n ? a[i] - '0' : 0);
        int db = (i < m ? b[i] - '0' : 0);
        int sum = da + db + carry;
        res.push_back(char('0' + (sum % 10)));
        carry = sum / 10;
    }
    if (carry) {
        res.push_back(char('0' + carry));
    }
  	//返回倒序得的数字
    return res;
}
```



### 减

```c++
string a, b;
string _minus(string a, string b){
    int na[MAXN] = {0}, nb[MAXN] = {0}, ans[MAXN] = {0};
    string diff; 
    if((a < b && a.size() <= b.size()) || b.size() > a.size()) return "-" + _minus(b, a);
    for(int i = a.size(); i > 0; i --)na[i] = a[a.size() - i] - '0';
    for(int i = b.size(); i > 0; i --)nb[i] = b[b.size() - i] - '0';
    int maxl = max(a.size(), b.size());
    for(int i = 1; i <= maxl; i ++){
        if(na[i] < nb[i]){
            na[i + 1] --;
            na[i] += 10;
        }
        ans[i] = na[i] - nb[i];
    }
    while(ans[maxl] == 0)maxl --;//防止减后降位，多输出若干0
    if(maxl < 1)return "0";
    for(int i = maxl; i > 0; i --)diff += ans[i] + '0';//数组转化为字符串。 
    return diff;
}
```



### 乘

//负数情况只要单独判断一下符号位就行
```c++
vector<int> multiply(vector<int> a,vector<int> b){
    vector<int> res(a.size() + b.size(), 0);
    for (int i = 0; i < a.size(); ++i) {
        for (int j = 0; j < b.size(); ++j) {
            res[i + j] += a[i] * b[j];
            res[i + j + 1] += res[i + j] / 10;
            res[i + j] %= 10;
        }
    }
    while (res.size() > 1 && res.back() == 0) res.pop_back();//删除前导0
    return res;
}

vector<int> string_to_vector(string s) {
    vector<int> v;
    for (int i = s.size() - 1; i >= 0; --i) {
        v.push_back(s[i] - '0');
    }
    return v;
}

void print_vector(vector<int> v) {
    for (int i = v.size()-1;i>=0;--i) cout <<v[i];
    cout <<"\n";
}

string sa,sb;
int main() {
    cin>>sa>>sb;
    vector<int> a = string_to_vector(sa);
    vector<int> b = string_to_vector(sb);
    vector<int> result = multiply(a, b);
    print_vector(result);
    return 0;
}
```



### 高精除以低精

```c++
int b,r;
vector<int>A,c;
string n;
vector<int> div(vector<int> &A, int b, int &r){
    vector<int> C;
    r = 0;
    for (int i = A.size() - 1; i >= 0; i -- ){
        r = r * 10 + A[i];
        C.push_back(r / b);
        r %= b;
    }
    reverse(C.begin(), C.end());
    while (C.size() > 1 && C.back() == 0) C.pop_back();
    return C;
}
int main(){
    cin>>n>>b;
    for(int i = n.size()-1;i>=0;i--){
        A.push_back(n[i]-'0');
    }
    c = div(A,b,r);
    for(int i = c.size()-1;i>=0;i--){
        printf("%d",c[i]);
    }
    printf("\n%d",r);
}
```



### 二分

```c++
int l = 0,r = n;
while(l<=r){
	int mid = l+r>>1;
	if(a[mid]<=k) l=mid+1;
	else r = mid-1;
}
```

$\leq$k ->r

$>$k ->l

求第 $k$ 大，可以变成第 $n-k$ 小，如果题目中有**小于等于**关系那么刚好可以对应，可以尝试check多少满足条件二分求解



### 三分

#### 浮点数三分

```c++
double lim_mi,lim_mx;
double work(double x){
    return x;
}
void solve(){
    double l=lim_mi,r=lim_mx;
    //暴力100次逼近答案;
    for(int i=1;i<=100;i++){
        double m1=(r-l)/3+l;
        double m2=(r-l)/3*2+l;
        //左半递增,右半递减
        if(work(m1)<work(m2)) l=m1;
        else r=m2;
    }
    cout<<work(l)<<endl;
}
```



#### 整数三分

```c++
typedef long long i64;
i64 lim_mi,lim_mx;
i64 calc(i64 x){
    return x;
}
void solve(){
    i64 l=lim_mi,r=lim_mx;
    //l+2是最小范围,可以调整l+3或者更大一些
    while(l+2<r){
        i64 m1=(r-l)/3+l;
        i64 m2=(r-l)/3*2+l;
        //左半递增,右半递减
        if(calc(m1)<calc(m2))
            l=m1;
        else 
            r=m2;
    }
    i64 ans=calc(l);
    for(int i=l+1;i<=r;i++){
        ans=max(ans,calc(i));
    }
    cout<<ans<<endl;
}
```



## 莫队

假设 $n=m$ ，对于序列上的区间询问问题，如果 $[l,r]$ 的答案能够 $O(1)$ 扩展到相邻区间的答案，那么可以在$O(n\sqrt{n})$ 复杂度内求出所有询问的答案，将询问离线下来，排序处理每个询问,对于区间 $[l,r]$ ,以 $\frac{l}{B}$ 所在块为第一关键字, $r$ 为第二关键字从小到大排序

```cpp
struct node{
	int l,r,id;
    //对于奇数块,r从小到大排序,对于偶数块，r从大到小排序
    bool operator<(const node &x)const{//奇偶常数优化排序
		if(l/B!=x.l/B) return l<x.l;
        if((l/B)&1) return r<x.r;
        return r>x.r;
    }
};
void add(int x){
    ...
}
void del(int x){
    ...
}
void solve(){
	int B = sqrt(n);
    sort(query,query+m,[](array<int,3> x,array<int,3> y){
		if(x[0]/B!=y[0]/B)  return x[0]/B<y[0]/B;
        return x[1]<y[1];
    });
    for(int i = 0,l = 1,r = 0;i<m;++i){
        //注意顺序,注意add()和del()是否需要特殊处理
		while(l>q[i][0]) add(a[--l]);
        while(r<q[i][1]) add(a[++r]);
        while(r>q[i][1]) del(a[r--]);
        while(l<q[i][0]) del(a[l++]);
        ans[q[i][2]] = nowANS;
    }
}
```



## 手写bitset

L[x]:块内左侧连续1的数量						R[x]:块内右侧连续1的数量

Cnt[x]:预处理出 $2^b$ 种块的答案					Val[x]:实际块的答案

```cpp
inline unsigned long long bit_between(int l,int r){//提取位掩码
    u64 res = r==63?-1ull:(1ull<<(r+1))-1;
    res^=(1ull<<l)-1;
    return res;
}

inline void Update(int val,u64 &res,int &ri){
    res+=ri*L[val]+Cnt[val];//本段全1子区间数 + 上次尾巴连续的1和右边的1可以拼出1的数量
    ri = R[val]+(L[val]>>4)*ri;//如果全是1，那么ri+=L[i]否则等于这一块右侧连续的1
}

struct Bitset{
    int sz, ptr;//ptr 当且写入的指针
    vector<u64> vec;//一个元素存储的是64位
    Bitset():Bitset(0){}
    Bitset(int _sz){
        sz=_sz;
        ptr=0;
        vec.resize((_sz+63)>>6);
    }

    void Add(int cnt,u64 val){//ptr&63 当前所在块的内部偏移量，相当于ptr%64
        if(cnt<=64-(ptr&63)){//当且写出比特数cnt<=这一块还有的剩余空间(说明可以一口气写入)
            vec[ptr>>6]|=val<<(ptr&63);//ptr>>6 表示要写哪块元素,val<<(ptr&63) 表示写入正确的位置(低位已经有ptr&63个位置填了)
        }else{
            u64 mask = bit_between(0,64-(ptr&63)-1);//64-(ptr&63)-1 :当前块能写入的最高索引位置
            vec[ptr>>6] |= (val&mask) <<(ptr&63);//截取当前块写入的部分val
            vec[(ptr>>6)+1] = val>>(64-(ptr&63));//val>>(64-(ptr&63)) 未写入的部分
        }
        ptr+=cnt;
    }

    void get_same(const Bitset&rhs){
        while(sz!=ptr||rhs.sz!=rhs.ptr) assert(false);//异常处理
        for(int i = 0;i<vec.size();++i) vec[i]^= ~rhs.vec[i];//相同部分置1
        int mn_sz = min(sz,rhs.sz);
        for(int i = mn_sz>>6;i<vec.size();++i){//清理后面多出来的越界比特块
            int l_bit = max(0,mn_sz-(i<<6));//首个无效地址位
            int r_bit = 63;
            vec[i] &= ~bit_between(l_bit,r_bit);
        }
    }

    u64 Calc(){
        u64 res =0;
        for(int i = 0,ri=0;i<vec.size();++i){
            Update(vec[i]&(S-1),res,ri);
            Update(vec[i]>>16&(S-1),res,ri);
            Update(vec[i]>>32&(S-1),res,ri);
            Update(vec[i]>>48&(S-1),res,ri);
        }
        return res;
    }

    void out()const{
        cout<<"sz= "<<sz<<" : ";
        for(int i = 0;i<sz;++i) cout<<((vec[i>>6]>>(i&63))&1);
        cout<<"\n";
    }
};

Bitset get_bitset(int l,int r){
    Bitset res(r-l+1);
    if((l>>6)==(r>>6)){//同一块
        u64 val = (Val[l>>6]&bit_between(l&63,r&63))>>(l&63);
        res.Add(r-l+1,val);
    }else{
        u64 val = (Val[l>>6]&bit_between(l&63,63))>>(l&63);
        res.Add(63-(l&63)+1,val);
        for(int i = (l>>6)+1;i<(r>>6);++i) res.Add(64,Val[i]);
        val = Val[r>>6] &bit_between(0,r&63);
        res.Add((r&63)+1,val);
    }
    return res;
}
```





## 杂

### 各种小知识点

**浮点数不可以读入很多**

对于$\sum_{i=1}^{n} i*f(i)$的式子通常可以转化为$\sum_{i=1}^{n}\sum_{j=i}^{n}f(j)$

对于找类似于**x**是否是中位数的题目,可以另比它大的数为1,小的为-1，看总和是否为0

判断有向图是不是有孤立的连通块，可以看出度为0的强连通分量是否大于1，大于1说明有孤立的连通块

斐波那契数列模**任意**的数 $k$ 一定会有循环,循环长度最多不超过 **$6\cdot k$**

对于斐波那契数列$F$,$F[1]=F[2]=1$, $gcd(F_n,F_m)=F_{gcd(n,m)}$

我们想要查询从任意位置开始的子数组，对于任意的 $X$ 找到第一个大于等于 $X$ 的位置，可以用 **ST表/线段树+二分** 解决，维护区间 $max$

$1-10^9$ 范围内的数质因子个数最多不超过**9**个,$1-1e18$ 范围内的数质因子个数最多不超过**15**个

往左处理一次，往右处理一次,即往相反方向做同样处理，可以翻转数组，把操作封装成函数

$[0,2^n-1]$中二进制出现 $i$ 个1的数字有$C\binom{i}{n}$ 个

斐波那契数列的矩阵递推形式:
$$
\begin{pmatrix}F(n+1) \\ F(n)\end{pmatrix}  = \begin{pmatrix}1 & 1 \\ 1 & 0\end{pmatrix}\begin{pmatrix}F(n) \\ F(n-1)\end{pmatrix}= M \begin{pmatrix}F(n) \\ F(n-1)\end{pmatrix}
$$

$$
\begin{pmatrix}F(n+1) \\ F(n)\end{pmatrix} = M^n \begin{pmatrix}1 \\ 0\end{pmatrix}
$$

也就是说 $M$ 矩阵会为计算斐波那契数列带来 $1$ 的贡献

马在棋盘中等问题可以把点分成两个集合$((i+j)\&1)$，马只能攻击到和自己异色的方格中,可以转化为二分图或者网络流问题

**互异**可以转化为流量全为1的网络跑最大流或者二分图**匹配**，相当于求匹配

对字符串添加最少的字符使其无法成为子序列 $\iff$ 在 $nxt$ 数组(子序列自动机)中通过最少得额外跳跃使 $nxt[p][c]=n$ ,维护 $d[i]$ 即可, $d[i] = 1+d[max(nxt[i+1][c])]$ 

处理完事件的时候需要立即进行一次答案更新，否则会出现问题。



想找到第一个区间左端点大于 $[x,y]$ 的区间我们可以。

```cpp
lower_bound(interval.begin(),interval.end(),{x+1,y})
```

vector 频繁emplace_back和pop_back开销很大，可以考虑手写stack替代。

**颜色不同**作为条件常常需要维护**最大**和**次大**。

图上构造，满足**奇偶性**，一般会考虑生成树

前n个数异或和结论:

- 当 $n\bmod4=0$ 时，前 $n$ 个数异或结果等于 $n$。

- 当 $n\bmod4=1$ 时，结果为 $1$。

- 当 $n\bmod4=2$ 时，结果为 $n+1$。

- 当 $n\bmod4=3$ 时，结果为 $0$。

原数组的 $gcd$ 等于 差分数组的 $gcd$ (差分数组加上 $a_1$)

如果做**同一个操作**但是在**不同位置**，可以考虑对数组进行**操作**，而非复制一遍

**取模**意义下比较大小不能直接取 $min/max$

对于一个排列，交换两个数的位置，**逆序对个数奇偶性变化**，不是排列需要分段考虑贡献



$-2$ 进制进位公式 : $t[i]\cdot (-2)^i=d\cdot (-2)^i+(\frac{t[i]-d}{-2}) \cdot(-2)^{i+1}$ , $d$ 是当前位结果， $(\frac{t[i]-d}{-2})$ 是进位

$1-1e9$ 的数字的因子数最多只有 $1344$

$\gcd(\frac{a}{gcd(a,b)},\frac{b}{gcd(a,b)})=1$



随机化获得区间众数，区间内随机取数，再二分验证计数

从 $n$ 开始往下找 一个与 $a$ 互质的数常数很小，如果 $n\le 10^6$ ，常数是 $25$



交换一次数组的任意元素  $a_i$ ,$a_j$ , 如果 $j-i$ 是奇数，那么数组逆序对奇偶性改变



同时是 $n$ 的倍数 又是 $m$ 的倍数 $\iff$ 是 $lcm(n,m)$ 的倍数 

- 在区间 $[0,nm)$ 内，这样的数是:

  ${0,lcm,2lcm,...,(g-1)lcm}$, 一共 $\frac{nm}{lcm(n,m)} = gcd(n,m)=g$ 个


一个SCC中，所有环的和都为0 $\iff$ 存在位势函数 $d$ ,使得 $\forall u\ \forall v\ d[v]-d[u] = w(u,v)$ 若 $u,v$ 有边存在 

提示数组中元素 $\le n$ 的时候，可能需要开和值域相关的数组。有些情况元素比较大，可以考虑离散化，在考虑和值域相关的东西

**中心对称** 可以用 **哈希+线段树** 处理区间操作和询问

- 如果可以把这些数配成 $\frac{m}{2}$ 对(m 区间长度),且每对和为 $S$ ,则 $\frac{m}{2} \cdot S=\sum_{i=L}^{R}a_i$ 

​	所以要满足 $(2T)\ mod\ m=0$ (即 $S$ 必须是整数) ，那么所有数关于 $\frac{S}{2}$ 对称,即 			     	$c(x)=c(S-x)$

- 所以只需要检验 $\sum g^{a_i}=\sum g^{S-a_i}=g^S\sum g^{-a_i}$ , $g$ 是 $hash$ 底数

一个$i\rightarrow j$ 的边权为 $w$ 这样子构成的矩阵 $T$ , $T^k$ 代表 $i$ 走 $k$ 步到 $j$ 的边权乘积的和,$w \in{0,1}$ 代表$i\rightarrow j$ 走k步的路径数. **矩阵幂** = 在某个代数系统下，把‘走一步’这个线性/半线性转移反复复合 $k$ 次



连续的一些数(0\*1\*0)长得像单峰函数不可以三分

###  树

如果两条路径在某个顶点 $x$ 上有且仅有一次交点，这个顶点 $x$ 必定是至少一条路径的 $LCA$

要想统计同组( $LCA$ 相同)其它各条路径一个端点落在 $L$ 子树但不落在 $a$ 子树,也不落在 $b$ 子树里的所有情况,即 $ldf$ , $rdf$ 为DFS序的左右端点,那么对于某条路径 $p=(x,y,L,a,b)$ (起点，终点，LCA，x的祖先且是L的儿子，y的祖先且是L的儿子)
$$
\begin{aligned}
&\underbrace{\Bigl[\text{BIT.sum}(\,rdf[L]\,)-\text{BIT.sum}(\,ldf[L]-1\,)\Bigr]}_{\substack{\text{所有端点落在}L\text{子树}\\\text{之内的总数}}} \\[-1ex]
&\quad-\;\underbrace{\Bigl[\text{BIT.sum}(\,rdf[a]\,)-\text{BIT.sum}(\,ldf[a]-1\,)\Bigr]}_{\substack{\text{落在}a\text{子树}\\\text{之内的}}}
\;-\;\underbrace{\Bigl[\text{BIT.sum}(\,rdf[b]\,)-\text{BIT.sum}(\,ldf[b]-1\,)\Bigr]}_{\substack{\text{落在}b\text{子树}\\\text{之内的}}}.
\end{aligned}
$$
这样就统计出了和 $p$ 只有一个交点，且LCA不同的路径条数，要统计所有这样的路径对，扫描线思想，按 **lca深度** 从小到大排序，每个lca处理完后，对当前lca的所有路径, $ldf[x_i]++,rdf[y_i]++$

满二叉树的**根**节点一定是**重心**



一些 **区间加操作** 可以往差分数组上想



### 找到是否有可能得dfs

```c++
bool check(int x,int y,int mid){
    if(x==n) return 1;
    flag[x][y]=1;
    bool fla=0;
    for(int i = 0;i<4;++i){
        int x1 = x+xx[i],y1 = y+yy[i];
        if(x1>=1&&x1<=n&&y1>=1&&y1<=m&&!flag[x1][y1]&&mp[x1][y1]<=mid){
            fla|=check(x1,y1,mid);
        }
    }
    return fla;
}
```



### 有向图找权值和非0环

**1.** 先用Tarjan缩点 求出 SCC

**2.** 对每个 SCC:

- 建一个栈/队列,挑任意一点 $r$ 设 `d[r]=0`,其余 `d=INF`

- 沿着SCC内部多DFS/BFS赋值:

  - 若 `d[v]` 未定 : 置 `d[v] = d[u]+w(u,v)` ,入栈,记录 `parent[v]=u`

  - 若已定 :检查 `d[v]==d[u]+w(u,v)`; 不等 $\implies$ 发现非0环.

    找到的矛盾边 $(u \rightarrow v)$

    - 这是只做一个 $BFS/DFS$ (在该 $SCC$ 内) 从 `v` 找到 `u` 的一条有向边，与边 $(u \rightarrow v)$ 拼起来就是一个非0环

- 全部通过 $\implies$ 该SCC所有环的和为0

```cpp
bool ok(int st){
    while(!q.empty()) q.pop();
    d[st] = 0;
    q.push(st);
    while(!q.empty()){
        int x = q.front();
        q.pop();
        for(auto &[y,w]:g[x]){
            if(scc[y]!=scc[x]) continue;//只在同一个scc内做判断
            if(d[y]==inf){//没有访问过
                d[y] = d[x] + w;
                q.push(y);
            }else{
                if(d[y]!=d[x]+w){
                    //说明有非0环
                    return true;//这里不需要构造环
                }
            }
        }
    }
    return false;
}
for(int i = 0;i<n;++i){//在每个scc内找是否有非0环
    if(vis[scc[i]]) continue;
    yes[scc[i]] |= ok(i); //ok(i) = true 说明有非0环
    vis[scc[i]]  = 1;
}
```



构造环的话就在找到矛盾的地方，用之前记录的`p[v]=u` ,找一条 $v\rightarrow u$ 的路径



### $\binom{n}{k}$的爆搜的写法即某些情况的优化

维护一个后缀(异或)和,发现后面都是要选的话直接加上后缀和

```c++
void dfs(int i,int k,i64 x){//求c(n,k)个数的异或max
    if(k==0){
        ans =max(ans,x);
        return;
    }
    if(i+k-1==n){
        ans = max(ans,x^suf[i]);//如果是求区间和类似
        return;
    }
    dfs(i+1,k,x);
    dfs(i+1,k-1,x^a[i]);
}
```



### O3优化

```c++
#pragma GCC optimize(3,"Ofast","inline")
```



### 后缀MEX

```c++
vector<int> suf_mex(n);
vector<int> vis(n+1,0);
int mex = 0;
for(int i =n-1;i>=1;--i){
    if(a[i]<=n) vis[a[i]]=1;
    while(vis[mex]) mex++;
    suf_mex[i] = mex;
}
```



### 判断杨辉三角第n行m列的奇偶性

```cpp
for (int i = 0; i <n; i++) {
     cout << (((n-1) & i) == i ? 1 : 0) << " \n"[i == n-1];
}
```

### DFS过程过维护1-u的路径

```cpp
void dfs(int u, int fa) {
    path.push_back(u); // 进入节点时加入路径
    for (int v : g[u]) {
        if (v == fa) continue;
        dfs(v, u);
    }
    path.pop_back(); // 回溯，退出时移除
}
```



### 子数组长度至少为k的最大中位数

前缀和+滑动窗口维护，枚举右端点 $i$ ，记录最小值 $mi$ , 如果存在长度 $\ge\  k$  的子数组使得前缀和 $c[R]-c[L]\ge 0$ 说明该子数组中 $\ge x$ 的元素不少于 $< x$ 的元素数量,及中位数 $\ge x$ 。之后二分中位数即可。 check含义:能否找到一个中位数 $\ge x$ ，且长度至少为 $k$ 的子数组 

**最小中位数** : 与前面类似，我想求的是子数组 "$>$ x" 的元素个数  $\le$ 子数组 "$\le $ x" 的元素个数，那么只要修改映射 。

​									$+1$ 当 $a[i]\le x$ , $-1$ 当 $a[i]>x$ 

**单调性**:	

-  若存在子数组中位数 ≤ `x`，那么对任意更大的 `y > x`，这个子数组也肯定中位数 ≤ `y`。

- 因此 `check_min(x)` 在区间上也是单调的：先是假→到真，一次翻转。

```cpp
auto check=[&](int x)->bool{
    for(int i = 0;i<n;++i) c[i+1] = c[i]+(a[i]>=x?1:-1); 
    int mi = 0; bool ok = false;int L=0,R=0;
    for(int i = k;i<=n;++i){
        if(c[i-k]<mi){
            mi = c[i-k];
            L = i-k;
        }
        if(c[i]>=mi){
            ok=1;R=i;break;
        } 
    }
    if(ok){ansl=L;ansr=R;return 1;}
    return 0;
};
```







### linux下的对拍

更好的随机种子 mt19937_64 rng(time(0));

std.cpp

```cpp
freopen("std.out", "w", stdout);
```



tmp.cpp

```cpp
freopen("tmp.out", "w", stdout);
```



rand.cpp

```cpp
#include <iostream>
#include <ctime>//rand函数需要
#include <algorithm>
using namespace std;
mt19937_64 rng(time(0));
int main(){
    //更随机做法
    freopen("/dev/urandom", "r", stdin);  
	srand(getchar()*getchar()*getchar()*time(0));
    //普通做法
    //freopen("rand.out", "w", stdout);
	int n = rng() % 10 + 1;
	cout << n << endl;
	while(n--){
		int a = rng() % 100 + 1;
		cout << a << " ";
	}
	cout << endl;
}
```



check.cpp

```cpp
#include <algorithm>
#include <cstdlib>
using namespace std;
int main(){
	int T = 10000;
	int tot = 0;
	while(T--){
		tot++;
		cout << tot << " ";
		system("./rand; ./std; ./tmp");
		if(system("diff std.out tmp.out")){
			cout << "WA" << endl;
			return 0;
		}
		else cout << "AC" << endl;
	}
}
```



### 打表压缩上传

```python
import zlib
import base64
with open('output.txt','rb') as f:
    data = f.read()
#压缩部分,每个元素要换行
compressed_data=zlib.compress(data,level=9)
b64_encoded = base64.b64encode(compressed_data).decode('ascii')
with open('zlib_output.txt','w') as f:
    f.write(b64_encoded)

#解压部分
#假设你获得了 base64 压缩字符串
b64_str = ''' 
'''.strip() #中文的引号,输入压缩出来的字符串

compressed_bytes = base64.b64decode(b64_str) # 1. base64 解码
raw_bytes = zlib.decompress(compressed_bytes) # 2. zlib 解压缩
text = raw_bytes.decode('utf-8') # 3. 转换为字符串
lines = text.splitlines() # 4. 按行变成数组

t = int(input())
for _ in range(t):
    n = int(input())
    if 1 <= n <= len(lines):
        print(lines[n - 1])
    else:
        print(f"❌ 行号 {n} 越界，应该在 1 到 {len(lines)} 之间")
```





# 数据结构



## 小知识点

树的BFS序排索引满足$x\leq y $, 那么$p_x \leq p_y$ ,$p_i$ 是 $i$ 节点的父亲节点编号

根为1不变的前提下，区间LCA等价于区间 $[L,R]$ 中 $dfs$ 序中最小值和最大值对应的两个点的 $lca$ 。

根为 $rt$ 时,求两个点 $x,y$ 的 $lca$ (q次查询，预处理默认根为1)，**新的LCA**为 $LCA(x,y),LCA(x,rt),LCA(y,rt)$中深度最大的那个节点。所以区间换根LCA是找**dfn序离x最近的两个点**(一个小于，一个大于)

维护按照 $index$ 的顺序对每一项是加/减等差数列的一项，求区间和,可以用线段树维护 $a_0$ 和 $d$,同时需要懒标记,对区间的 $sum$ 可以用等差数列公式求出，在update中需要记录更新中可以把新的值当成待更新量

- $lazy$ 更新

  - ```cpp
    lazy[node*2+1] = add(lazy[node*2+1], lazy[node]); // 右儿子拿原值
    int rig = (r - mid);
    lazy[node].base += rig * lazy[node].dif;          // 调整 base
    lazy[node*2] = add(lazy[node*2], lazy[node]);     // 左儿子拿调整后的
    ```

- $update$更新

  - ```cpp
    update(right child, x, y, val);       // 右儿子用原来的 val
    if (y > mid) {                        // 右儿子确实吃到了一段
        int rig = (min(y, r) - mid);      // 右儿子吃了 rig 个元素
        val.base += rig * val.dif;        // 数列前进 rig 步，再交给左儿子
    }
    update(left child, x, y, val);        // 左儿子用调整后的 val
    //val 存的a0 和 d
    ```

  - 如果是正常区间加, $d=0$ 即可

$x$ 的子树内, 与 $x$ 相差 $y$ 距离的点的BFS序是连续的区间

- 查找
- ![image-20251111205836710](C:\Users\h't\AppData\Roaming\Typora\typora-user-images\image-20251111205836710.png)



## 并查集

#### 板子

```c++
struct DSU{
    vector<int> fa, sz, used, mn, mx;
    DSU(int n){
        fa.assign(n, 0);
        sz.assign(n, 1);
        used.assign(n, 0);
        mx.assign(n, 0);
        mn.assign(n, 0);

        for (int i = 0; i < n; i++) fa[i] = i;
    }
    int find(int u){
        if (fa[u] == u) return u;
        fa[u] = find(fa[u]);
        return fa[u];
    }
    void unite(int u, int v){
        u = find(u);
        v = find(v);
        if (u == v) return;
        if (sz[u] < sz[v]) swap(u, v);
        fa[v] = u;
        sz[u] += sz[v];
        used[u] += used[v];
        mn[u] = min(mn[u], mn[v]);
        mx[u] = max(mx[u], mx[v]);
    }
    bool same(int u, int v){
        return find(u) == find(v);
    }
    int size(int u){
        u = find(u);
        return sz[u];
    }
};
```



#### 开k倍空间讨论

```c++
int n,k;
int fa[200010];//fa[i] i是 a ;fa[i+n] i是b;fa[i+2*n] i是c
int find(int x){return fa[x]==x?x:fa[x]=find(fa[x]);}
void merge(int x,int y){fa[find(x)]=find(y);}
int main(){
    cin>>n>>k;
    for(int i = 1;i<=3*n;++i) fa[i] = i;
    int cnt = 0;
    for(int i = 1;i<=k;++i){
        int op,y,x;
        scanf("%d%d%d",&op,&x,&y);
        if(y>n||x>n){
            cnt++;
            continue;
        }
        if(op==1){
            if(find(x)==find(y+n)||find(x)==find(y+2*n)){
                cnt++;
            }else{
                merge(x,y);
                merge(x+n,y+n);
                merge(x+2*n,y+2*n);
            }
        }else{
            if(find(x)==find(y)||find(x)==find(y+2*n)){
                cnt++;
            }else{
                merge(x,y+n);
                merge(x+n,y+2*n);
                merge(x+2*n,y);
            }
        }
    }
    cout<<cnt;
    return 0;
}
```



## DSU On Tree

#### 思想:

统计轻子树答案，统计完删除信息
再统计重子树的答案，统计完删除信息
将重子树合并到子树u重
再统计轻子树的答案
判断u子树的信息是否需要传递给父亲

#### Eg.统计子树众数和

```c++
vector<int>g[maxn];
int sz[maxn],son[maxn],HH;
int c[maxn],color[maxn];
i64 n,now,mx;
i64 ans[maxn];
void dfs(int x,int fa){
    sz[x] = 1;
    for(auto y:g[x]){
        if(y==fa) continue;
        dfs(y,x);
        sz[x]+=sz[y];
        if(sz[y]>sz[son[x]]) son[x] = y;
    }
}

void calc(int x,int fa,bool op){
    if(op==1){
        ++color[c[x]];
        if(color[c[x]]>mx) mx = color[c[x]],now = c[x];
        else if(color[c[x]]==mx) now+=c[x];
    }else{
        --color[c[x]];
    }
    for(auto y:g[x]){
        if(y==fa||y==HH) continue;
        calc(y,x,op);
    }                               
}

void dsu(int x,int fa,bool op){//op=0 ：不保留信息 1:保留信息
    for(auto y:g[x]){
        if(y==fa||y==son[x]) continue;
        dsu(y,x,0);//先遍历轻儿子，op=0，信息不做保留
    }
    if(son[x]) dsu(son[x],x,1),HH = son[x];//保留重儿子的信息，标记重儿子
    calc(x,fa,1);//再次统计轻儿子的答案
    ans[x] = now;//统计答案
    HH=0;
    if(!op) calc(x,fa,0), mx=0,now=0; //清空轻子树,如果op=0,则u对于它的父亲来说是轻儿子,不需要传递
}
```



## 树状数组二分



```cpp
// kth：返回最小的pos，使得 sum(pos) >= k
// 若不存在（k > sum(n)）返回 -1
inline int kth(i64 k){
    if(sum(n) < k) return -1; // 不存在这么大的前缀和

    // pw = 最高的 2^p 且 2^p <= n
    // __lg(n) = floor(log2(n))，要求 n > 0
    int pw = 1 << __lg(n);

    int idx = 0;
    for(int step = pw; step; step >>= 1){
        int nxt = idx + step;
        if(nxt <= n && (i64)bitv[nxt] < k){
            idx = nxt;
            k  -= bitv[nxt];
        }
    }
    return idx + 1;
}
```







## 线段树

线段树二分时如果有懒标记需要更新懒标记

```c++
#include<bits/stdc++.h>
using namespace std;

int n,m;
int a[100000];
int tree[4*10000];//数组要开到4倍n
int lazy[4*10000];
void build(int p,int l,int r){
    lazy[p]=0;
    if(l==r){
        tree[p]=a[l];
        return;
    }
    int mid = (l+r)>>1;
    build(p*2,l,mid);
    build(p*2+1,mid+1,r);
    tree[p]=tree[p*2]+tree[p*2+1];
}

void pushdown(int p,int l,int r){
    int mid = (r+l)/2;//
    lazy[p*2] += lazy[p];
    lazy[p*2+1]+=lazy[p];
    tree[p*2] += lazy[p]*(mid-l+1);
    tree[p*2+1] += lazy[p]*(r-mid);
    lazy[p]=0;
}

void change(int p,int l,int r,int x,int y,int num){
    if(x<=l&&r<=y){
        tree[p]+=num*(r-l+1);
        lazy[p]+=num;
        return;
    }
    if(lazy[p]!=0){
        pushdown(p,l,r);
    }
    int mid=(l+r)/2;
    if(x<=mid) change(p*2,l,mid,x,y,num);
    if(y>mid) change(p*2+1,mid+1,r,x,y,num);
    tree[p]=tree[p*2]+tree[p*2+1];
}

int calc(int p,int l,int r,int x,int y){
    if(x>r||y<l) return 0;//推荐写ans版本不然得话要写这一句,每个问题return的还不太一样;
    if(x<=l&&r<=y){
        return tree[p];
    }
    if(lazy[p]!=0){
        pushdown(p,l,r);
    }
    int mid = (l+r)/2;
    if(y<=mid) return calc(p*2,l,mid,x,y);
    if(x>=mid+1) return calc(p*2+1,mid+1,r,x,y);
    return calc(p*2,l,mid,x,mid)+calc(p*2+1,mid+1,r,mid+1,y);
    /*int ans=0;
    if(x<=mid) ans+=calc(p*2,l,mid,x,y);
    if(y>mid) ans+=calc(p*2+1,mid+1,r,x,y);
    return ans;*/
}

int main(){
    scanf("%d%d",&n,&m);
    for(int i = 1;i<=n;++i) scanf("%d",a+i);
    build(1,1,n);//build(当前节点编号，当前编号左界，当前编号右界)
    //for(int i = 1;i<=100;++i) cout<<tree[i]<<" ";
    for(int i = 1;i<=m;++i){
        int x,y,z;
        char op;
        scanf(" %c",&op);//在%c前面加一个空格，以跳过前面的换行符
        if(op=='C'){
            scanf("%d%d%d",&x,&y,&z);
            change(1,1,n,x,y,z);
        }else{
            scanf("%d%d",&x,&y);
            cout<<calc(1,1,n,x,y)<<"\n";
        }
    }
    return 0;
}
```



### 动态开点

核心思想:再需要用到这个区间的时候再创建

#### 单点修改

```cpp
// root 表示整棵线段树的根结点；cnt 表示当前结点个数
int n, cnt, root;
int sum[n * 2], ls[n * 2], rs[n * 2];

// 用法：update(root, 1, n, x, f); 其中 x 为待修改节点的编号
void update(int& p, int s, int t, int x, int f) {  // 引用传参
  if (!p) p = ++cnt;  // 当结点为空时，创建一个新的结点
  if (s == t) {
    sum[p] += f;
    return;
  }
  int m = s + ((t - s) >> 1);
  if (x <= m)
    update(ls[p], s, m, x, f);
  else
    update(rs[p], m + 1, t, x, f);
  sum[p] = sum[ls[p]] + sum[rs[p]];  // pushup
}
```



#### 区间询问

```cpp
// 用法：query(root, 1, n, l, r);
int query(int p, int s, int t, int l, int r) {
  if (!p) return 0;  // 如果结点为空，返回 0
  if (s >= l && t <= r) return sum[p];
  int m = s + ((t - s) >> 1), ans = 0;
  if (l <= m) ans += query(ls[p], s, m, l, r);
  if (r > m) ans += query(rs[p], m + 1, t, l, r);
  return ans;
}
```





### 势能线段树+线段树二分

- 给定一个长度为 $$n$$ $ 的数组 $ $$a$$。你的任务是处理 $q$ 次以下三种类型的查询：

  -   $$1~i~x$$$ —— 将 $$$a_i$$$ 设为 $$$x$$。
  -   $$2~l~r~x$$$ —— 对于所有满足 $$$l \le i \le r$$$ 的 $$$i$$$，将 $$$a_i$$$ 设为 $$$\gcd(a_i,x)$$$，其中 $$$\gcd(x,y)$$$ 表示能同时整除 $$$x$$$ 和 $$$y$$$ 的最大整数。
  -   $$3~l~r$$$ —— 计算 $$$\sum_{i=l}^ra_i$$。

  对于每个类型 $$3$$ 的查询，输出其答案。

  把区间操作变成单点修改:

  1.初始化 $i$ 为 $l$

  2.找到最小的 $j\geq l$ 且 $gcd(a_j,x)!=a_j$

  3.不存在 $j$ 或者 $j>r$ 退出循环，否则更新 $a_j=gcd(a_j,x),i = j+1$

  2,3步骤最多执行log次，如何快速执行操作2，线段树二分即可，维护区间lcm，找到第一个不整除前缀lcm的位置

```cpp
#pragma GCC optimize(3,"Ofast","inline")
#include <bits/stdc++.h>
using namespace std;
using i64 = long long;
using i128 = __int128;
#define int long long

constexpr int maxn = 1e5 + 10;
constexpr i64 INF = 1e9 + 7;
constexpr i64 LCM_LIMIT = 1e7;

int n, q;
int a[maxn];
i64 tree[maxn << 2];

// 计算 a 和 b 的 LCM，若超出限值返回 INF
i64 lcm_val(i64 a, i64 b) {
    i128 t = (i128)a / __gcd((i64)a, (i64)b) * b;
    if (t > LCM_LIMIT) return INF;
    return (i64)t;
}

void push_up(int p) {
    tree[p] = lcm_val(tree[p << 1], tree[p << 1 | 1]);
    if (tree[p] > LCM_LIMIT) tree[p] = INF;
}

void build(int p, int l, int r) {
    if (l == r) {
        tree[p] = a[l];
        return;
    }
    int m = (l + r) >> 1;
    build(p << 1, l, m);
    build(p << 1 | 1, m + 1, r);
    push_up(p);
}

void update(int p, int l, int r, int idx, int val) {
    if (l == r) {
        tree[p] = val;
        return;
    }
    int m = (l + r) >> 1;
    if (idx <= m) update(p << 1, l, m, idx, val);
    else update(p << 1 | 1, m + 1, r, idx, val);
    push_up(p);
}

// 查询区间 LCM
i64 query(int p, int l, int r, int ql, int qr) {
    if (ql <= l && r <= qr) return tree[p];
    int m = (l + r) >> 1;
    if (qr <= m) return query(p << 1, l, m, ql, qr);
    if (ql > m)  return query(p << 1 | 1, m + 1, r, ql, qr);
    return lcm_val(query(p << 1, l, m, ql, m),
                   query(p << 1 | 1, m + 1, r, m + 1, qr));
}

// 在 [ql, qr] 范围内，寻找第一个位置 pos，使得 lcm(cur, seg[ql..pos]) 不整除 x
int find_first(int p, int l, int r, int ql, int qr, i64 &cur, i64 x) {
    if (qr < l || r < ql) return -1;
    if (ql <= l && r <= qr) {
        i64 combined = lcm_val(cur, tree[p]);
        if (x % combined == 0) {//不满足条件的置成-1
            // 整个段都满足条件，更新 cur 并跳过
            cur = combined;
            return -1;
        }
        // 若段已经不能整除且已细化到叶节点，则返回该位置
        if (l == r) {
            return l;
        }
    }
    int m = (l + r) >> 1;
    int res = find_first(p << 1, l, m, ql, qr, cur, x);
    if (res != -1) return res;
    return find_first(p << 1 | 1, m + 1, r, ql, qr, cur, x);
}

// 维护前缀和，用于求区间和
int tr[maxn];
inline int lowbit(int x) { return x & -x; }
void bit_add(int x, int v) {
    for (; x <= n; x += lowbit(x)) tr[x] += v;
}
i64 bit_sum(int x) {
    i64 s = 0;
    for (; x > 0; x -= lowbit(x)) s += tr[x];
    return s;
}

void solve() {
    cin >> n >> q;
    for (int i = 1; i <= n; ++i) {
        cin >> a[i];
        bit_add(i, a[i]);
    }
    build(1, 1, n);

    while (q--) {
        int op;
        cin >> op;
        if (op == 1) {
            int pos, v;
            cin >> pos >> v;
            bit_add(pos, v - a[pos]);
            a[pos] = v;
            update(1, 1, n, pos, v);
        } else if (op == 2) {
            int l, r;
            i64 x;
            cin >> l >> r >> x;
            // 用线段树二分替代遍历
            i64 cur = 1;
            while (l <= r) {
                int p = find_first(1, 1, n, l, r, cur, x);
                if (p == -1) break;   // 区间内都能整除，结束
                // 对 p 位置做更新：a[p] = gcd(a[p], x)
                int oldv = a[p];
                a[p] = __gcd((i64)a[p], x);
                bit_add(p, a[p] - oldv);
                update(1, 1, n, p, a[p]);
                l = p + 1;
            }
        } else {
            int l, r;
            cin >> l >> r;
            cout << (bit_sum(r) - bit_sum(l - 1)) << "\n";
        }
    }
}

signed main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    solve();
    return 0;
}
```





## 扫描线

### Eg.求矩阵面积并(区间覆盖问题)

```cpp
#include <bits/stdc++.h>
using namespace std;
using i64 = long long;

struct Event {
    i64 x;
    int y1, y2;
    int type; // +1 for entering, -1 for leaving
    bool operator<(const Event &p) const {
        return x < p.x;
    }
};

struct Scanline {
    int n;               // number of unique y-coordinates
    vector<i64> ys;       // sorted unique y-values
    vector<int> cnt;     // cover count
    vector<i64> len;      // covered length

    Scanline(const vector<i64> &_ys) {
        ys = _ys;
        n = ys.size();
        cnt.assign(4 * n, 0);
        len.assign(4 * n, 0);
    }

    // 向上维护节点覆盖长度
    void pushup(int p, int l, int r) {
        if (cnt[p] > 0) {
            len[p] = ys[r + 1] - ys[l];
        } else if (l == r) {
            len[p] = 0;
        } else {
            len[p] = len[p << 1] + len[p << 1 | 1];
        }
    }

    // 区间更新 [ql, qr]
    void update(int p, int l, int r, int ql, int qr, int val) { //ql,qr代表要更新的区间
        if (ql > r || qr < l) return;
        if (ql <= l && r <= qr) {
            cnt[p] += val;
            pushup(p, l, r);
            return;
        }
        int mid = (l + r) >> 1;
        update(p << 1, l, mid, ql, qr, val);
        update(p << 1 | 1, mid + 1, r, ql, qr, val);
        pushup(p, l, r);
    }

    // 计算给定矩形集合的面积
    i64 calc_area(vector<Event> &events) {
        sort(events.begin(), events.end());
        i64 area = 0;
        for (int i = 0; i < (int)events.size(); i++) {
            if (i > 0) {
                i64 dx = events[i].x - events[i - 1].x;
                area += len[1] * dx;
            }
            int y1 = lower_bound(ys.begin(), ys.end(), ys[events[i].y1]) - ys.begin();
            int y2 = lower_bound(ys.begin(), ys.end(), ys[events[i].y2]) - ys.begin() - 1; //看成一个点对应一个区间,例如x对应[x,x+1)
            update(1, 0, n - 2, y1, y2, events[i].type);
        }
        return area;
    }
};

 int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int m;
    cin >> m;
    // 存储矩形 (x1, y1, x2, y2)
    vector<tuple<i64,i64,i64,i64>> rects(m);
    // 用于离散化的 y 值集合
    vector<i64> ys;
    for (int i = 0; i < m; i++) {
        i64 x1, y1, x2, y2;
        cin >> x1 >> y1 >> x2 >> y2;
        rects[i] = make_tuple(x1, y1, x2, y2);
        ys.push_back(y1);
        ys.push_back(y2);
    }

    // 离散化 y 坐标
    sort(ys.begin(), ys.end());
    ys.erase(unique(ys.begin(), ys.end()), ys.end());

    // 初始化扫描线结构
    Scanline sc(ys);
    vector<Event> events;
    events.reserve(2*m);

    // 构造进入/离开事件
    for (auto &t : rects) {
        i64 x1, y1, x2, y2;
        tie(x1, y1, x2, y2) = t;
        int y1_idx = int(lower_bound(ys.begin(), ys.end(), y1) - ys.begin());
        int y2_idx = int(lower_bound(ys.begin(), ys.end(), y2) - ys.begin());
        // 注意：这里我们让 [y1_idx, y2_idx) 作为要覆盖的区间
        events.push_back({ x1, y1_idx, y2_idx, +1 });  // 矩形左边界，覆盖 +1
        events.push_back({ x2, y1_idx, y2_idx, -1 });  // 矩形右边界，覆盖 -1
    }

    i64 area = sc.calc_area(events);
    cout << area << "\n";
    return 0;
}
```







## 倍增求LCA

```cpp
int fa[maxn][20],dep[maxn];//第二维取决于n的大小
void dfs(int x,int f){
    fa[x][0] = f;
    dep[x] = dep[f]+1;
    for(auto y:g[x]){
        if(y==f) continue;
        dfs(y,x);
    }
}
void update(){
    for(int j = 1;j<20;++j){
        for(int i = 1;i<=n;++i){
            fa[i][j] = fa[fa[i][j-1]][j-1];
        }
    }
}
int lca(int x,int y){
	if(dep[x]<dep[y]) swap(x,y);
    for(int i = 19;i>=0;--i){
        if(dep[x]-dep[y]>=(1<<i)){
            x = fa[x][i];
        }
    }
    if(x==y) return x;
    for(int i = 19;i>=0;--i){
        if(fa[x][i]!=fa[y][i]){
            x = fa[x][i],y = fa[y][i];
        }
    }
    return fa[x][0];
}
```



## 求k级祖先

```cpp
int jump(int x,int h){
    for(int i = 0;i<20;++i) if((h>>i)&1) x = fa[x][i];
    return x;
}
```

$fa$ 是预处理出来的 $2^i$ 祖先







## 树链剖分+线段树查询(LCA,路径)

### 重链剖分

例题:
I. CHANGE u t : 把结点u的权值改为t  
II. QMAX u v: 询问从点u到点v的路径上的节点的最大权值 I  
II. QSUM u v: 询问从点u到点v的路径上的节点的权值和  

```c++
const int maxn = 3e4+10;
int n;
int a[maxn];
vector<int> g[maxn];

int dep[maxn],fa[maxn],siz[maxn],son[maxn]，bottom[maxn];//bottom[i]，i重链的底部节点
void dfs1(int x,int f){
    dep[x] = dep[f]+1;
    fa[x] = f;
    siz[x]=1;
    bottom[x] =x;
    for(auto y:g[x]){
        if(y==f) continue;
        dfs1(y,x);
        siz[x]+=siz[y];
        if(siz[y]>siz[son[x]]){
            son[x]=y;
            bottom[x] = bottom[y];
        }
    }
}

int tmp=0;
int dfn[maxn],ff[maxn],top[maxn];
void dfs2(int x,int f,int tp){
    dfn[x]=++tmp;//dfn序
    ff[tmp]=x;//逆映射
    top[x]=tp;
    if(son[x]!=0) dfs2(son[x],x,tp);
    for(auto y:g[x]){
        if(y==f||y==son[x]) continue;
        dfs2(y,x,y);
    }
}

struct ty{
    int sum,mx;
}tree[maxn<<2];

void pushup(int p,int l,int r){
    tree[p].sum = tree[p*2].sum+tree[p*2+1].sum;
    tree[p].mx = max(tree[p*2].mx,tree[p*2+1].mx);
}

void build(int p,int l,int r){
    if(l==r){
        tree[p].sum=tree[p].mx = a[ff[l]];
        return;
    }
    int mid = (l+r)>>1;
    build(p*2,l,mid);
    build(p*2+1,mid+1,r);
    pushup(p,l,r);
}

void change(int p,int l,int r,int x,int y,int num){
    if(x<=l&&r<=y){
        tree[p].sum=tree[p].mx = num;
        return;
    }
    int mid = (l+r)>>1;
    if(x<=mid) change(p*2,l,mid,x,y,num);
    if(y>mid) change(p*2+1,mid+1,r,x,y,num);
    pushup(p,l,r);
}

i64 querry_mx(int p,int l,int r,int x,int y){
    if(x<=l&&r<=y) return tree[p].mx;
    int mid = (l+r)>>1;
    i64 ans = -0x3f3f3f3f;
    if(x<=mid) ans = max(ans,querry_mx(p*2,l,mid,x,y));
    if(y>mid) ans = max(ans,querry_mx(p*2+1,mid+1,r,x,y));
    return ans;
}

i64 querry_sum(int p,int l,int r,int x,int y){
    if(x<=l&&r<=y) return tree[p].sum;
    int mid = (l+r)>>1;
    i64 ans = 0;
    if(x<=mid) ans += querry_sum(p*2,l,mid,x,y);
    if(y>mid) ans += querry_sum(p*2+1,mid+1,r,x,y);
    return ans;
}

i64 qmx(int x,int y){
    i64 res = -0x3f3f3f3f;
    while(top[x]!=top[y]){
        if(dep[top[x]]<dep[top[y]]) swap(x,y);
        res=max(res,querry_mx(1,1,n,dfn[top[x]],dfn[x]));
        x = fa[top[x]];
    }
    if(dep[x]>dep[y]) swap(x,y);
    res = max(res,querry_mx(1,1,n,dfn[x],dfn[y]));
    return res;
}

i64 qsum(int x,int y){
    i64 res = 0;
    while(top[x]!=top[y]){
        if(dep[top[x]]<dep[top[y]]) swap(x,y);
        res+=querry_sum(1,1,n,dfn[top[x]],dfn[x]);
        x = fa[top[x]];
    }
    if(dep[x]>dep[y]) swap(x,y);
    res+=querry_sum(1,1,n,dfn[x],dfn[y]);
    return res;
}

int main(){
    ios;
    cin>>n;
    for(int i = 1;i<n;++i){
        int x,y;cin>>x>>y;
        g[x].push_back(y);
        g[y].push_back(x);
    }
    for(int i = 1;i<=n;++i) cin>>a[i];
    dfs1(1,0);
    dfs2(1,0,1);
    build(1,1,n);
    int q;cin>>q;
    for(int i = 1;i<=q;++i){
        string op;int x,y;
        cin>>op>>x>>y;
        if(op[0]=='C'){ 
            change(1,1,n,dfn[x],dfn[x],y);
        }else if(op[1]=='M'){//max查询
            cout<<qmx(x,y)<<"\n";
        }else{
            cout<<qsum(x,y)<<"\n";
        }
    }
    return 0;
}
```



#### 查询LCA

```c++
int lca(int a, int b) {
  while (top[a] != top[b]){         //一直跳跃到a和b在同一条链上
    if (dep[top[a]] > dep[top[b]])   //重链头节点深度大的先跳
      a = fa[top[a]];                //跳到所在重链头节点后再向上跳跃一次
    else b = fa[top[b]];
  }
  return dep[a] < dep[b] ? a : b;
}
```



#### 边权转化成点权

```c++
int a[maxn];
void dfs1(int x,int f){
    fa[x]=f;
    dep[x]=dep[f]+1;
    siz[x]=1;
    for(ty y:g[x]){
        if(y.t==f) continue;
        dfs1(y.t,x);
        a[y.t]=y.w;  //remark
        siz[x]+=siz[y.t];
        if(siz[y.t]>siz[son[x]]) son[x]=y.t;
    }
}
```



#### 边权变点权之后的查询

```c++
i64 qsum(int x,int y){
    i64 res=0;
    while(top[x]!=top[y]){
        if(dep[top[x]]<dep[top[y]]) swap(x,y);
        res+=query(1,1,n,dfn[top[x]],dfn[x]);
        x = fa[top[x]];
    }
    if(dep[x]>dep[y]) swap(x,y);
    res+=query(1,1,n,dfn[x]+1,dfn[y]);  //remark
    return res;
}
```



## 主席树

**处理区间第k小**

```c++
const int maxn = 2e5+10;
int n,m,a[maxn];
vector<int> v;
inline int find(int x){
    return lower_bound(v.begin(),v.end(),x)-v.begin()+1;
}
struct node{
    int l,r,sum;
}hjt[maxn*32];
int cnt,root[maxn];

void insert(int l,int r,int pre,int &now,int p){//当前l,r 上一版本线段树编号pre,p是插入位置
    hjt[++cnt] = hjt[pre];
    now = cnt;
    hjt[now].sum++;
    if(l==r) return;
    int mid = (l+r)>>1;
    if(p<=mid) insert(l,mid,hjt[pre].l,hjt[now].l,p);
    else insert(mid+1,r,hjt[pre].r,hjt[now].r,p);
    //now的引用只会对上一层有作用,因为后面递归传入新的需要操作的节点
}

int query(int l,int r,int L,int R,int k){//L:L版本的权值线段树的当前节点 R:R版本的权值线段树遍历的当前节点，求第k小
    if(l==r) return l; 
    int mid = (l+r)>>1;
    int tmp = hjt[hjt[R].l].sum-hjt[hjt[L].l].sum;
    if(k<=tmp) return query(l,mid,hjt[L].l,hjt[R].l,k);
    else return query(mid+1,r,hjt[L].r,hjt[R].r,k-tmp);
}

int QUERY(int l,int r,int L,int R,int num){//查询区间[l,r]有多少数小于num
    int tmp = hjt[R].sum-hjt[L].sum;
    if(l>num) return 0;
    if(r<=num) return tmp;
    int mid = (l+r)>>1;
    return query(l,mid,hjt[L].l,hjt[R].l,num)+query(mid+1,r,hjt[L].r,hjt[R].r,num);
}

signed main(){
    ios::sync_with_stdio(0);cin.tie(0);cout.tie(0);
    cin>>n>>m;
    for(int i = 1;i<=n;++i){
        cin>>a[i];
        v.emplace_back(a[i]);
    }
    sort(v.begin(),v.end());
    int len = v.erase(unique(v.begin(),v.end()),v.end())-v.begin();
    for(int i = 1;i<=n;++i) insert(1,len,root[i-1],root[i],find(a[i]));
    while(m--){
        int l,r,k;//求区间[l,r]的第k小
        cin>>l>>r>>k;
        cout<<v[query(1,len,root[l-1],root[r],k)-1]<<"\n";
    }
    return 0;
}
```

**Addition:**

对于二元组 $(x,y)$ , 以 $x$ 为索引，对 $y$ 值求区间第 $k$ 小步骤:

- 对所有元素按 x 的顺序（通常是 x 递增）构建**前缀版本**：`root[i]` 表示前 i 个元素（x 最小的 i 个）对应的 y 值的多重集合在一棵“值域线段树”上的表示。

- 线段树是建立在 **y 的坐标压缩后值域** 上（范围是 `1..M`，M = 不同 y 值数）。

- ###### 对区间查询 `[L,R]`，集合就是 `root[R] - root[L-1]`（两版本节点差），再在这棵差集树上做 kth 查询（第 K 小）。

- kth 查询在树上自顶向下走：比较左子树中差值计数，决定向左还是向右走。

- ```cpp
  // build prefix versions: root[i] 表示前 i 个元素（按 zeros 排序）插入后的版本
  //插入
  for (int i = 1; i <= n; ++i) {
   	int ones_val = a[i-1][1];
      int comp = int(lower_bound(W.begin(), W.end(), ones_val) - W.begin()) + 1; // 1-based
      insert_seg(1, M, root[i-1], root[i], comp);
  }
  //查询
  int idx_comp = kth_small(1, M, root[0], root[pos], K); // 第 K 小
  ```

- 注意二者都经过压缩,W存的是 $x$ , `1...M` 是 $y$ 值 ，访问的话**需要映射回原数值**



## 虚树 Virtual Tree

目的: **浓缩信息，把一棵大树浓缩成一棵小树**

```cpp
int dfn[maxn];
int h[maxn],m,len;
vector<int> a;
bool cmp(int x,int y){
    dfn[x]<dfn[y]; //按照dfs序排序
}

void build_virtual_tree(){
    sort(h+1,h+m+1,cmp);//按照dfs序排序
    for(int i = 1;i<m;+i){
        a.emplace_back(h[i]);//相邻两点的LCA插入
        a.emplace_back(lca(h[i],h[i+1]));
    }
    a.emplace_back(h[m]);
    sort(a.begin(),a.end(),cmp);//虚树上的点按照dfs序排序
    len = a.erase(unique(a.begin(),a.end()),a.end())-a.begin();
    for(int i = 0,lc,i<len-1;++i){
        lc = lca(a[i],a[i+1]);
        connect(lc,a[i+1]);
    }
}
```







## ST表

```c++
struct STList{
    int n,k;
    vector<vector<int>> st;
    STList(){}
    STList(const vector<int> &a){
        init(a);
    }
    void init(const vector<int>&a){
        n = a.size();
        k = __lg(n)+1;
        st.resize(n,vector<int>(k));
        for(int i = 0;i<n;++i) st[i][0] = a[i];
        for(int j = 1;j<k;++j){
            for(int i = 0;i+(1<<j)<=n;++i){
                st[i][j] = max(st[i][j-1],st[i+(1<<(j-1))][j-1]);
            }
        }
    }
    int query(int l,int r){
        int j = __lg(r-l+1);
        return max(st[l][j],st[r-(1<<j)+1][j]);
    }
};
```

### O(1) LCA 思路

1. 对树做一遍 DFS，记录 Euler 序列 `euler[]`，同时记录每个节点第一次出现在 euler 里的位置 `first[u]`，以及对应的深度数组 `dep[]`。

2. LCA(u, v) 就等价于：在 `euler[first[u] ... first[v]]` 这一段里，**找深度最小的那个节点** → 这是一个区间 RMQ。

3. 区间 RMQ 用稀疏表，预处理 log 和 st，查询就是两次 `min`，O(1)。



## 笛卡尔树

建树复杂度 $O(n)$ , 一种二叉树，每个节点有键值二元组 $(k,w)$ 构成，要求 $k$ 满足二叉搜索树的性质, $w$  满足堆(大根堆/小根堆都可以)的性质, $k$ 不相同 , $w$ 也不相同

二叉搜索树性质:

- 若左子树非空,左子树所有节点的值的值小于根节点的值
- 若右子树非空,右子树所有节点的值大于根节点的值
- 左右子树也是二叉搜索树，性质递归成立

堆性质: 任意节点的值都大于(小于)或等于其子节点的值



```cpp
struct MinCartesian {
    int n;
    const i64* a; // pointer to data
    vector<int> L, R, P, st;//左儿子，右儿子，父亲，stack,size
    vector<int> sz, dep;
    MinCartesian(int _n = 0) { build_empty(_n); }
    void build_empty(int _n) {
        n = _n;
        a = nullptr;
        L.assign(n, -1);
        R.assign(n, -1);
        P.assign(n, -1);
        st.assign(n, 0);
        sz.assign(n, 0);
        dep.assign(n,0);
    }
    int build_from(const i64* arr, int _n) {//静态数组构建,0-based
        n = _n; a = arr;
        L.assign(n, -1); R.assign(n, -1); P.assign(n, -1);
        st.reserve(n); sz.assign(n,0); dep.reserve(n);
        int top = 0;
        for (int i = 0; i < n; ++i) {
            int last = -1;
            while (top > 0 && arr[st[top-1]] > arr[i]){//维护小根堆性质,所以是单调递增栈
                last = st[--top];
            }
            if (top > 0) {//i变成新的右链节点
                R[st[top-1]] = i;
                P[i] = st[top-1];
            }
            if (last != -1) {//左旋,i的左儿子变成上一个从栈弹出的
                L[i] = last;
                P[last] = i;
            }
            st[top++] = i;
        }
        // root is bottom of stack
        int root = -1;
        if (top > 0) root = st[0];
        if(root != -1) dep[root] = 1;
        return root;
    }

    void dfs(int x){
        sz[x] = 1;
        if(L[x] != -1){
            dep[L[x]] = dep[x] + 1;
            dfs(L[x]);
            sz[x] += sz[L[x]];
        }
        if(R[x]!=-1){
            dep[R[x]] = dep[x] + 1;
            dfs(R[x]);
            sz[x] += sz[R[x]]; 
        }
    }

};
```









# 字符串

## manacher(最长回文子串)

都归结到计算奇回文串处理, $p[i]$ 表示以 $i$ 为中心的回文半径**+1**

```c++
int manacher(string s){
    int n=(int)s.size();
    vector<int> p(2*n+2);
    vector<char> t(2*n+2);
    int m =0;
    t[++m]='$';//改造字符串使其变为奇字符串
    for(int i = 0;i<n;++i){
        t[++m]=s[i];
        t[++m]='$';
    }
    int M=0,R=0;
    for(int i = 1;i<=m;++i){
        if(i>R) p[i]=1;
        else p[i] = min(p[2*M-i],R-i+1);
        while(i-p[i]>=1&&i+p[i]<=m&&t[i-p[i]]==t[i+p[i]])p[i]++;//往外暴力枚举
        if(i+p[i]-1>R) M=i,R=i+p[i]-1;
    }
    return *max_element(p.begin(),p.end())-1;
}
```



## Hash

小trick:可以直接用 unsigned long long 进行运算，那就避免了取模的过程，并且hash碰撞概率也不高

```c++
const i64 mod = 10000000000000061;//不能写1e16+61,大质数写单hash不容易冲突,写大质数的话需要__int128计算
i64 h[maxn],p[maxn];//取余int范围内模数开int
p[0] = 1;
for(int i = 1;i<maxn;++i)  p[i] = (p[i-1]*b1)%mod;
int b1 = 37;
for(int i = 1;i<s.size();++i) h[i] = (h[i-1]*b1%mod+s[i]-‘a’+1ll)%mod;
int get(int l,int r,i64 *h,i64 *p,int mod){
    return i128(1ll*h[r] - 1ll*h[l-1]*p[r-l+1]%mod+mod)%mod;//大质数取模需要__int128
}
```

 

## KMP

```c++
int nex[maxn];
void init(string s){
    int n = s.size();
    for(int i=1;i<n;++i){//n为字符串长度，前面没有空格
        int j = nex[i-1];
        while(j>0 && s[i]!=s[j]) j=nex[j-1];//表示含义代表失配时跳转的位置
        j+=(s[j]==s[i]);
        nex[i] = j;
    }
}
```

**//计算循环节
//|s|-Border就是周期**

```c++
vector<int> kmp(string text,string pattern){
    string cur = pattern+'#'+text;
    int sz1 = text.length(),sz2 = pattern.length();//前面都是没有空格的
    vector<int>v;
    init(cur);//计算border
    for(int i = sz2+1;i<=sz1+sz2;++i){
        if(nex[i]==sz2) v.push_back(i-2*sz2);
    }
    return v;
}
```

### 统计内容相同的子串对

我们要统计所有 **内容相同** 的子串对。一个经典的方法是：

对每个起点 $i=1\ldots n$，把从 $i$ 出发的「后缀」当作模式串 $P=s[i\ldots n]$，把整个原串 $T=s[1\ldots n]$ 当作文本串，跑一次 KMP。

这样，每一次匹配都会告诉你：模式串的前缀 $P[1\ldots L]$ 在文本串中出现过一个位置 $j$。

那么，就意味着子串
$$
s[i\ldots i+L-1]\;=\;s[j-L+1\ldots j]
$$


这是一对 **内容相同** 的子串。并且，如果最大匹配长度是 $L_{\max}$，那么从 $1$ 到 $L_{\max}$ 的所有长度 $L$ 都是匹配的，因此为每个 $i$ 我们加上
$$
\sum_{j:\,\text{匹配结束位置}} \bigl(\pi[j]\bigr)
$$
就能把所有长度从 $1$ 到 $\pi[j]$ 的子串都统计进来。

具体步骤：

1. **构造串**

​	对固定的 $i$，令$S = P + "\#" + T = s[i\ldots n]\,\#\,s[1\ldots n].$ 

​	这里“#”是一个不在字母表中的分隔符，保证不会出现跨境匹配。

2. **计算前缀函数 $\pi$**

   对 $S$ 运行一次线性 KMP 前缀函数算法，得到数组 $\pi[1\ldots |S|]$。

3. **统计贡献**

   只看那些落在“文本串”部分的位置，也就是下标 $j$ 从 $|P|+2$ 到 $|P|+1+n$。
   
   若此时 $\pi[j]=L>0$，表示模式串前 $L$ 字符在文本串以位置 $j$ 结尾处匹配上了，那么就会多出 $L$ 对相同子串（长度从 1 到 $L$）。所以对每个 $i$ 加上 $\sum_{j=|P|+2}^{|P|+1+n} \pi[j].$
   
   累加所有 $i=1\ldots n$，便得到了 $\text{cnt}_{\rm real}$。

整个过程总共做了 $n$ 次 KMP，每次处理长度约 $n+i$，总复杂度仍然是 $O(n^2)$。





## Trie(字典树)

```c++
struct trie {
  int nex[100000][26], cnt;
  bool exist[100000];  // 该结点结尾的字符串是否存在

  trie(){
    cnt = 0;
    memset(nex,0,sizeof nex);
    memset(exist,0,sizeof exist);
  }

  void insert(const string &s){//插入
    int p = 0;
    for(char ch:s){//从索引0开始到结尾
      int c = ch-'a';//只能处理全是小写字母,要普适需修改
      if(!nex[p][c]) nex[p][c] = ++cnt;
      p = nex[p][c];
    }
    exist[p]=1;
  }
  bool find(const string &s)const{
    int p = 0;
    for(char ch:s){
      int c = ch-'a';
      if(!nex[p][c]) return 0;
      p = nex[p][c];
    }
    return exist[p];
  }
};

trie t;
t.insert("abc");
if(t.find("abc")) cout<<"YES\n";
```



### XOR 问题

#### 求大于k的最小区间长度

节点存储，到该节点的最大索引

在每次插入$a_i$的时候，沿着 $a_i\ xor\ k$ 的路径下降,如果 $k$ 的这一位是1，沿着 $a_i\ xor\ 1$ 的位置下降，如果k这一位是0,检查 $a_i\ xor 1$ 子树中的最大索引，**但仍然 $a_i\ xor\ 0$ 的边下降**

```cpp
#pragma GCC optimize(3,"Ofast","inline")
#include<bits/stdc++.h>
using namespace std;
using i64 = long long;
using i128 = __int128;

struct node{
    array<int,2> child;
    int last;
    node():child({-1,-1}),last(-1){};//默认构造
    node(array<int,2> child,int last):child(child),last(last){};
};

int find(const vector<node> &trie,int value,int border){
    int res = -1;
    int p =0;
    bool ok=true;
    for(int i = 29;ok&&i>=0;--i){
        int x_bit = (value>>i) &1;
        int k_bit = (border>>i)&1;
        auto &child = trie[p].child;
        if(k_bit==1){
            if(child[x_bit^1]!=-1) p = child[x_bit^1];
            else ok = 0;
        }else{
            if(child[x_bit^1]!=-1){
                res = max(res,trie[child[x_bit^1]].last);
            }
            if(child[x_bit]!=-1) p = child[x_bit];
            else ok = 0;
        }
    }
    if(ok) res = max(res,trie[p].last);
    return res;
}

void add(vector<node>&trie,int value,int idx){
    int p = 0;
    trie[p].last = max(trie[p].last,idx);
    for(int i = 29;i>=0;--i){
        int bit = (value>>i)&1;
        if(trie[p].child[bit]==-1){
            trie[p].child[bit]=trie.size();
            trie.push_back(node());
        }
        p = trie[p].child[bit];
        trie[p].last = max(trie[p].last,idx);
    }
}

int n,k;
void solve(){
    cin>>n>>k;
    vector<node> trie(1);//创建根节点
    int ans = n+1;
    for(int i = 0;i<n;++i){
        int x;cin>>x;
        add(trie,x,i);
        int y = find(trie,x,k);
        if(y!=-1) ans = min(ans,i-y+1);
    }
    cout<<(ans==n+1?-1:ans)<<"\n";
}

signed main(){
    ios::sync_with_stdio(0);cin.tie(0);
    int t=1;
    cin>>t;
    while(t--) solve();
    return 0;
}
```





## AC自动机

```c++
struct trie{
    //maxn较大的时候要把数组拿到外面去
    int tr[maxn][26], cnt;
    int exist[maxn];  //该结点结尾的字符串是否存在
    int fail[maxn]; //fail[u]指向的节点v表示v是u的最长后缀匹配
    trie(){
        cnt = 0;
        memset(tr,0,sizeof tr);
        memset(fail,0,sizeof fail);
        memset(exist,0,sizeof exist);
    }
    void insert(const string &s){//插入
        int p = 0;
        for(char ch:s){//从索引0开始到结尾
            int c = ch-'a';//只能处理全是小写字母,要普适需修改
            if(!tr[p][c]) tr[p][c] = ++cnt;
            p = tr[p][c];
        }
        exist[p]=1;
    }

  void build() {
        queue<int> q;
          for (int i = 0; i < 26; i++){
                if(tr[0][i]) q.push(tr[0][i]);
          }
          while(!q.empty()){
              int u = q.front();
              q.pop();
              for (int i = 0; i < 26; i++) {
                  if(tr[u][i]){
                    fail[tr[u][i]] = tr[fail[u]][i];//儿子存在，建回跳边
                    q.push(tr[u][i]);
                  }else tr[u][i] = tr[fail[u]][i];//建转移边
              }
        }
      /*构建fail树
      for(int i = 1;i<=cnt;++i){
          g[fail[i]].push_back(i);
      }
      构建fail树可以在失配时高效跳转,对fail树进行dfs可以累积匹配结果
      */
    }

    int query(const string &s){
        int u = 0,res = 0;
        for(char ch:s){
             u = tr[u][ch-'a'];
             for(int j = u;j&&exist[j]!=-1;j = fail[j]){
                res+=exist[j];
                    exist[j] = -1;//防止重复统计模式串，根据题目而定
                }
        }
        return res;
    }
};

```





# 图论

小知识: DFS 生成树中如果遇到已经走过的节点$v$且不是当前节点$u$的父亲,那么$(u,v)$ 必然是返祖边，某些情况可以 $O(1)$ 树上差分

对于特殊的边权(例如边权为0)有使用次数限制可以考虑先求出不使用特殊边的最短路，然后再使用对应图论算法(最短路等求解)



## 欧拉路径

**奇数度的节点大于2或者图不连通无解**

时间复杂度O(n)

```cpp
vector<int> cur(2 * n);//当前节点已经扫描到哪个位置了
vector<bool> vis(n);//是否访问过
auto dfs = [&](auto &&self, int x) -> void {//->void 是必要的
    for (int &j = cur[x]; j < adj[x].size(); j++) {
        auto [y, i] = adj[x][j];//y节点，节点对应的输入index
        if (!vis[i]) {
            vis[i] = true;
            self(self,y);
            ans.push_back(i);
        }
    }
};
dfs(dfs,s);
if (ans.size() != n) {//判断图是否连通
    cout << "NO\n";
    return;
}
```





## 拓扑排序

```c++
int n,m;
struct ty{
	int t,next;
}edge[100010];
int head[1010];
int cnt = 0;

void addedge(int x,int y){
	edge[++cnt].t= y;
	edge[cnt].next = head[x];
	head[x]=cnt;
}
int inc[1010];
queue<int> q;
void tuopu(){
	for(int i = 1;i<=n;++i){
		if(inc[i]==0){
			q.push(i);
		}
	}
	int tot=0;
	while(!q.empty()){
		int x = q.front();
		q.pop();
		tot++;//顶点数
		for(int i = head[x];i!=-1;i = edge[i].next){
			inc[edge[i].t]--;
			if(inc[edge[i].t]==0) q.push(edge[i].t);
		}
	}
	if(tot!=n) cout<<-1;
}

```

**拓扑排序找环的话就是拓扑排序运行完之后inc数组值不等于0的就在环上面**

对于普通的有向图来说，只需要一次拓扑排序即可

**多次拓扑排序**,如基环树森林等，需要一个have_tuopu数组记录**是否已经跑过拓扑排序**才可以正确跑拓扑排序，不然可能会重复跑已经跑过的拓扑排序



## 线段树优化建图

```cpp
vector<pair<int,int>> g[maxn<<4];
int out_id[maxn<<4],in_id[maxn<<4];
int tot;//当前用到的最大编号
int n;
void build_out(int p,int l,int r){
    out_id[p] = ++tot;
    if(l==r){
        //线段树叶子节点代表原点l，叶子节点到原点连0边
        g[out_id[p]].emplace_back(l,0);
        return;
    }
    int mid = (l+r)>>1;
    build_out(p<<1,l,mid);
    build_out(p<<1|1,mid+1,r);
    //出树:father->son,0权
    g[out_id[p]].emplace_back(out_id[p<<1],0);
    g[out_id[p]].emplace_back(out_id[p<<1|1],0);
}

void point_to_seg(int p,int l,int r,
                        int x,int y,
                        int u,int w){//u->[x,y],边权为w,点到区间
    if(x<=l&&r<=y){
        //从u到线段树节点连一条边
        g[u].emplace_back(out_id[p],w);//注意是u
        return;
    }
    int mid = (l+r)>>1;
    if(x<=mid) point_to_seg(p<<1,l,mid,x,y,u,w);
    if(y>mid) point_to_seg(p<<1|1,mid+1,r,x,y,u,w);
}

void build_in(int p,int l,int r){
    in_id[p] = ++tot;
    if(l==r){
        g[l].emplace_back(in_id[p],0);
        return;
    }
    int mid = (l+r)>>1;
    build_in(p<<1,l,mid);
    build_in(p<<1|1,mid+1,r);
    //入树:son->father, 0权
    g[in_id[p<<1]].emplace_back(in_id[p],0);
    g[in_id[p<<1|1]].emplace_back(in_id[p],0);
}

void seg_to_point(int p,int l,int r,
                        int x,int y,
                        int v,int w){//[x,y]->v
    if(x<=l&&r<=y){
        //从线段树节点到x连边
        g[in_id[p]].emplace_back(v,w);//注意是v
        return;
    }
    int mid = (l+r)>>1;
    if(x<=mid) seg_to_point(p<<1,l,mid,x,y,v,w);
    if(y>mid) seg_to_point(p<<1|1,mid+1,r,x,y,v,w);
}
85854
void solve(){
    tot = n;
    build_in(1,1,n);
    build_out(1,1,n);
}
```

注意如果有两颗树的话,总点数会达到 $9\cdot n$



## 最短路



### Dijstra

```c++
int n,m,s,t,tot=0;
int head[1024];
struct ty{
	int t,l,next;
}edge[20010];

void addedge(int x,int y,int z){
	edge[++tot].l = z;
	edge[tot].t = y;
	edge[tot].next = head[x];
	head[x] = tot;
}

struct ty2{
	int x,dis;
	bool operator < (const ty2 &a)const{
		return dis>a.dis;
	}
};

priority_queue<ty2> q;
int dis[1024];
bool vis[1024];//最短路径是否已经更新
int dij(int s,int t){
	memset(dis,0x3f,sizeof(dis));
	memset(vis,0,sizeof(vis));
	dis[s]=0;
	ty2 tmp;
	tmp.x = s;tmp.dis = 0;
	q.push(tmp);
	while(!q.empty()){
		ty2 tmp = q.top();
		q.pop();
		if(vis[tmp.x]) continue;
		vis[tmp.x]=1;
		for(int i = head[tmp.x];i!=-1;i=edge[i].next){
			int y = edge[i].t;
			if(vis[y]) continue;
			if(dis[y]>dis[tmp.x]+edge[i].l){
				dis[y]=dis[tmp.x]+edge[i].l;
				ty2 tmp2;
				tmp2.x = y;tmp2.dis = dis[y];
				q.push(tmp2);
			}
		}
	}
	if(dis[t]>=0x3f3f3f3f) return -1;
	return dis[t];
}

int main(){
	scanf("%d%d%d%d",&n,&m,&s,&t);
	memset(head,-1,sizeof(head));
	for(int i = 1;i<=m;++i){
		int x,y,z;
		scanf("%d%d%d",&x,&y,&z);
		addedge(x,y,z);
		addedge(y,x,z);
	}
	printf("%d\n",dij(s,t));
	return 0;
}

```



精简写法:

dis一定程度上替代vis，将dis的判断让堆拿来执行（从 ${d+w_i}$和堆中本来存在的边选出min去更新最短路 ）

```c++
priority_queue<pair<i64,int>,vector<pair<i64, int>>,greater<>> q;
q.push({0,0});
while (!q.empty()) {
    auto [d, x] = q.top();
    q.pop();
    if (dis[x] != -1) {
        continue;
    }
    dis[x] = d;
    if (x == n - 1) {
        break;
    }
    for (auto [y, w] : adj[x]) {
        q.emplace(d + w, y);
    }
}
```









### SPFA

```c++
int dis[1024];
bool vis[1024];//有没有放进待更新队列中
queue<int> q1;
int spfa(int s,int t){
	memset(dis,0x3f,sizeof(dis));
	memset(vis,0,sizeof(vis));
	dis[s]=0;
	vis[s]=1;
	q1.push(s);
	while(!q1.empty()){
		int x = q1.front();
		q1.pop();
		vis[x]=0;
		for(int i =head[x];i!=-1;i = edge[i].next){
			int y = edge[i].t;
			if(dis[y]>dis[x]+edge[i].l){
				dis[y] = dis[x]+edge[i].l;
				if(!vis[y]){
					q1.push(y);
					vis[y] = 1;
				}
			}
		}
	}
	return dis[t]>=0x3f3f3f3f?-1:dis[t];
}

vector写法,双端队列优化
//没有负环，连接所有点，最短路，有负权边，spfa
#include<bits/stdc++.h>
using namespace std;
#define i64 long long
#define ios ios::sync_with_stdio(0);cin.tie(0);cout.tie(0);
const int maxn = 8e4+10,inf = 0x3f3f3f3f;
int n,p,r,s,dis[maxn];
bool vis[maxn];
deque<int> 	q;
vector<int> g[maxn],w[maxn];
void spfa(int s){
	memset(dis,inf,sizeof(dis));
	dis[s]=0;
	q.push_back(s);
	while(!q.empty()){
		int x = q.front();q.pop_front();
		vis[x]=0;
		for(int i = 0;i<g[x].size();++i){
			int y = g[x][i],d = w[x][i];
			if(dis[y]>dis[x]+w[x][i]){
				dis[y]=dis[x]+w[x][i];
				if(vis[y]) continue;
				vis[y]=1;
				if(q.empty()) q.push_back(y);
				else{
					if(dis[y]<dis[q.front()]) q.push_front(y);
					else q.push_back(y);
				}
			}
		}
	}
}
int main(){
    cin>>n>>r>>p>>s;
    for(int i = 1;i<=r;++i){
    	int a,b,c;
    	cin>>a>>b>>c;
    	g[a].push_back(b);g[b].push_back(a);
    	w[a].push_back(c);w[b].push_back(c);
	}
    for(int i = 1;i<=p;++i){
    	int a,b,c;
    	cin>>a>>b>>c;
    	g[a].push_back(b);
    	w[a].push_back(c);
	}
	spfa(s);
	for(int i = 1;i<=n;++i){
		dis[i]==inf?cout<<"NO PATH\n":cout<<dis[i]<<"\n";
	}
    return 0;
}

```



#### SPFA找环

```c++
#define i64 long long
//有负权边找环
int f,n,m,w;
struct ty{
    int t,next,l;
}edge[102400];
int head[102400],cnt=0;
bool vis[102400];
int tot[102400];
void addedge(int x,int y,int z){
    edge[++cnt]={y,head[x],z};
    head[x] = cnt;
}
int dis[102400];
bool spfa(){
    memset(dis,0x3f,sizeof(dis));
    memset(vis,0,sizeof(vis));
    memset(tot,0,sizeof(tot));
    queue<int> q;
    for(int i = 1;i<=n;++i){
    	q.push(i);
    	vis[i]=1;
	}
	while(!q.empty()){
		int x = q.front();
		q.pop();
		vis[x]=0;
		for(int i = head[x];i!=-1;i = edge[i].next){
			int y = edge[i].t;
			if(dis[y]>dis[x]+edge[i].l){
				dis[y]=dis[x]+edge[i].l;
				tot[y] = tot[x]+1;
				if(tot[y]>=n) return 0;//当一个点进入队列超过n次说明有负权回路
				if(!vis[y]){
					q.push(y);
					vis[y]=1;
				}
			}
		}
	}
	return 1;
}

void solve(){
    memset(head,-1,sizeof(head));
    cnt=0;
    cin>>n>>m>>w;
    for(int i = 1;i<=m;++i){
        int x,y,z;
        cin>>x>>y>>z;
        addedge(x,y,z);
        addedge(y,x,z);
    }
    for(int i = 1;i<=w;++i){
        int x,y,z;
        cin>>x>>y>>z;
        addedge(x,y,-z);
    }
    if(!spfa()){
        cout<<"YES\n";
    }else cout<<"NO\n";
}
int main(){
    ios;
    cin>>f;
    while(f--){
        solve();
    }
    return 0;
}

```





### Floyd

f[i][j]表示i到j经过小于k的点所能得到的临时最短路
枚举中转点k

```c++
for(int k = 1;k<=n;++k){
	for(int i = 1;i<=n;++i){
		for(int j = 1;j<=n;++j){
			if(i!=j&&j!=k&&k!=i){
				if(f[i][k]+f[k][j]<=f[i][j]) f[i][j] = f[i][k]+f[k][j];
			}
		}
	}
}
```



#### 最小环

用 **Dijkstra** 枚举所有边，每次删除一条边后对这条边的起点跑一次 **Dijkstra** ，复杂度 $O(m(n+m)logn)$



**Floyd:**

```cpp
constexpr int MAXN = 500;       
constexpr i64 INF = (i64)4e18;
// 原图邻接矩阵（1..n），无边请设为 INF，自环设为 0
i64 val[MAXN + 1][MAXN + 1];
// Floyd 最短路矩阵与中间点记录
i64 dis[MAXN + 1][MAXN + 1];
int pos[MAXN + 1][MAXN + 1];
// 记录最小环答案与路径
i64 ans;
int cnt,path[MAXN + 5];
inline void get_path(int u, int v) {  // 恢复 u 到 v 之间（不含两端点）的路径
    int k = pos[u][v];
    if (!k) return;
    get_path(u, k);
    path[++cnt] = k;
    get_path(k, v);
}

inline void Floyd(int n) {//n个点
    // 初始化 dis 和 pos
    memcpy(dis, val, sizeof(val));
    memset(pos, 0, sizeof(pos));
    ans = INF; cnt = 0;
    for (int k = 1; k <= n; ++k) {
        // 在用 k 更新最短路之前，枚举经过 k 的最小环
        for (int i = 1; i < k; ++i) {
            if (val[i][k] == INF) continue;
            for (int j = 1; j < i; ++j) {
                if (val[k][j] == INF || dis[i][j] == INF) continue;
                i64 cur = val[i][k] + val[k][j] + dis[i][j];
                if (cur < ans) {
                    ans = cur;
                    cnt = 0;
                    // 按照 i, k, j 的顺序加入
                    path[++cnt] = i;
                    path[++cnt] = k;
                    path[++cnt] = j;
                    get_path(j, i); // 补上 j 到 i 的中间点
                }
            }
        }
        // 标准 Floyd 更新最短路
        for (int i = 1; i <= n; ++i) {
            if (dis[i][k] == INF) continue;
            for (int j = 1; j <= n; ++j) {
                if (dis[k][j] == INF) continue;
                i64 cur = dis[i][k] + dis[k][j];
                if (cur < dis[i][j]) {
                    dis[i][j] = cur;
                    pos[i][j] = k;
                }
            }
        }
    }
}

```

- 使用说明:
- val 是地图的矩阵，$u$ 和$v$ 之间没有连边初始化为 $INF$ 
- `Floyd(n)`  之后 最小环长度:ans, 最小环路径 path[1...cnt]
- 真正意义上的闭合环:
  - path[1], path[2], ..., path[cnt], path[1]







### 同余最短路

同余最短路对每个点遍历连边时，连单向边

## 最小生成树



### Prim

#### 堆优化

```c++
int n,m;
struct ty{
	int t,l,next;
}edge[100000000];
int head[100000],cnt=0;
void addedge(int x,int y,int z){
	edge[++cnt].t = y;
	edge[cnt].l = z;
	edge[cnt].next = head[x];
	head[x] = cnt;
}
int vis[1000000];
struct ty2{
	int x,len;
	bool operator <(const ty2 &a)const{
		return len>a.len;
	}
};
priority_queue<ty2> q;
void prim(){
	vis[1]=1;
	ty2 tmp;
	for(int i = head[1];i!=-1;i=edge[i].next){
		tmp.x = edge[i].t;
		tmp.len = edge[i].l;
		q.push(tmp);
	}
	int ans = 0;
	while(!q.empty()){
		ty2 tmp = q.top();
		q.pop();
		int x = tmp.x;
		if(vis[x]) continue;
		vis[x]=1;
		ans+=tmp.len;
		for(int i = head[x];i!=-1;i = edge[i].next){
			if(vis[edge[i].t]) continue;
            ty2 tmp2;
			tmp2.x = edge[i].t;
			tmp2.len = edge[i].l;
			q.push(tmp2);
		}
	}
	cout<<ans<<"\n";
}
int main(){
	memset(head,-1,sizeof(head));
	scanf("%d%d",&n,&m);
	for(int i = 1;i<=m;++i){
		int a,b,v;
        cin>>a>>b>>v;
		addedge(a,b,v);
		addedge(b,a,v);
	}
	prim();
	return 0;
}

```



#### O($n^2$)邻接矩阵写法

```c++
bool vis[maxn]={0};
i64 dis[maxn];
void prim(){
    memset(dis,0x3f3f3f3f,sizeof dis);
    dis[0]=0;
    i64 ans=0;

    for(int count=0;count<=n;++count){
        int u = -1;
        for(int i = 0;i<=n;++i){
            if(!vis[i]&&(u==-1||dis[i]<dis[u])) u = i;
        }
        vis[u]=1;
        ans+=dis[u];
        for(int v = 0;v<=n;++v){
            if(g[u][v]&&!vis[v]&&g[u][v]<dis[v]){
                dis[v] = g[u][v];
            }
        }
    }
    cout<<ans<<"\n";
}

```



### Kruskal

```c++
struct ty{
	int x,y,z;
}edge[10000000];

bool cmp (ty a, ty b){
	return a.z<b.z;
}
int fa[1000000];
int find(int x){
	return fa[x]==x ? x : fa[x] = find(fa[x]); 
}
int n,m;
int main(){
	ios::sync_with_stdio(0);
	cin.tie(0);cout.tie(0);
	cin>>n>>m;
	for(int i =1;i<=n;++i) fa[i]=i;
	for(int i = 1;i<=m;++i){
		cin>>edge[i].x>>edge[i].y>>edge[i].z;
	}
	long long  ans = 0;
	sort(edge+1,edge+m+1,cmp);
	for(int i = 1;i<=m;++i){
		int fx = find(edge[i].x);
		int fy = find(edge[i].y);
		if(fx==fy) continue;
		ans+=edge[i].z;
		fa[fx] = fy; 
	}
	cout<<ans;
	return 0;
}

```





### 严格次小生成树



对于非严格次小生成树，找到一条未选中的边 $e'=(x,y,z)$ ,找到 $x\rightarrow y$ 的路径上边权最大的一条边 $e$ , 用 $e'$ 替换 $e$ ,得到一棵权值和位 $M'=M+w-w'$ 的树 $T'$,最所有替换的答案求 $min$ 就是非严格次小生成树

维护 $x\rightarrow y$ 的边权最大值类似求 $LCA$ ,用倍增维护

对于严格次小生成树,需要维护**最大和次大**，当用于替换的边的权值与原生成树中路径最大边权相等时，我们用严格次大值来替换



本模板用来求严格次小生成树，其中图里**有自环**

如果想要分奇偶求 $x\rightarrow y$ 路径上的最大边，最大和次大多开一维，DFS中对奇偶都处理一次，查询传入查奇数还是偶数即可

```cpp
constexpr int maxn = 3e5+10;
constexpr i64 INF = 1e9;
template <typename T>struct Edge{
    int u,v;
    T w;
    Edge()=default;
    Edge(int u,int v,T w):u(u),v(v),w(w){}
    bool operator<(const Edge &other)const{
        return w<other.w;
    }  
};
using edge = Edge<i64>;

static constexpr int LOG = 22;
static constexpr int NEG_INF = numeric_limits<int>::min();

class Tr {
private:
    struct Edge {
        int to, nxt, val;
    };

    vector<Edge> e;
    vector<int> head;
    int cnt;

    vector<array<int, LOG>> fa;
    vector<int> dep;
    // 到祖先的路径上边权最大的边
    vector<array<int, LOG>> max1;
    // 到祖先的路径上边权次大的边，若不存在则为 -INF
    vector<array<int, LOG>> max2;

public:
    // 构造函数：传入节点数 n，初始化各个数组的大小和默认值
    Tr(int n)
        : head(n+1, -1), dep(n+1, 0), fa(n+1), max1(n+1), max2(n+1), cnt(0) {
        e.reserve(2 * n);
        for (int i = 0; i <= n; ++i) {
            for (int j = 0; j < LOG; ++j) {
                fa[i][j]   = 0;
                max1[i][j] = NEG_INF;
                max2[i][j] = NEG_INF;
            }
        }
    }

    // 添加有向边
    void addedge(int u, int v, int val) {
        e.push_back({v, head[u], val});
        head[u] = cnt++;
    }

    // 添加无向边
    void insertedge(int u, int v, int val) {
        addedge(u, v, val);
        addedge(v, u, val);
    }

    // DFS 预处理深度、祖先和最大边权
    void dfs(int x, int parent) {
        dep[x] = dep[parent] + 1;
        fa[x][0] = parent;
        max2[x][0] = NEG_INF;

        for (int i = 1; (1 << i) <= dep[x]; ++i) {
            int p = fa[x][i - 1];
            fa[x][i] = fa[p][i - 1];
            array<int, 4> kk = { max1[x][i - 1], max1[p][i - 1], max2[x][i - 1], max2[p][i - 1] };
            sort(kk.begin(), kk.end());
            max1[x][i] = kk[3];
            int ptr = 2;
            while (ptr >= 0 && kk[ptr] == kk[3]) --ptr;
            max2[x][i] = (ptr >= 0 ? kk[ptr] : NEG_INF);
        }

        for (int idx = head[x]; idx != -1; idx = e[idx].nxt) {
            int to = e[idx].to;
            if (to == parent) continue;
            max1[to][0] = e[idx].val;
            dfs(to, x);
        }
    }

    // 求最近公共祖先
    int lca(int a, int b) const {
        if (dep[a] < dep[b]) swap(a, b);
        for (int i = LOG - 1; i >= 0; --i) {
            if (dep[a] - (1 << i) >= dep[b]) a = fa[a][i];
        }
        if (a == b) return a;
        for (int i = LOG - 1; i >= 0; --i) {
            if (fa[a][i] != fa[b][i]) {
                a = fa[a][i];
                b = fa[b][i];
            }
        }
        return fa[a][0];
    }

    // 查询从 a 到 ancestor 路径上最大的边权（排除值为 val 的边）
    int query(int a, int ancestor, int val) const {
        int res = NEG_INF;
        int diff = dep[a] - dep[ancestor];
        for (int i = LOG - 1; i >= 0; --i) {
            if (diff & (1 << i)) {
                if (max1[a][i] != val) res = max(res, max1[a][i]);
                else                res = max(res, max2[a][i]);
                a = fa[a][i];
            }
        }
        return res;
    }
};

edge e[maxn];
bool use[maxn];
int fa[maxn],n,m;
i64 sum = 0;;
int find(int x){
    return x==fa[x]?x:fa[x] = find(fa[x]);
}
bool merge(int x,int y){
    int fx = find(fa[x]),fy = find(fa[y]);
    if(fx==fy) return 0;
    fa[fy] = fx;
    return 1;
}

void kruskal(Tr &tr){
    sort(e+1,e+m+1);
    for(int i = 1;i<=n;++i) fa[i]=i;
    for(int i = 1;i<=m;++i){
        if(merge(e[i].u,e[i].v)){
            sum+=e[i].w;
            use[i]=true;
            tr.insertedge(e[i].u,e[i].v,e[i].w);
        }
    }
}


signed main(){
    ios::sync_with_stdio(0);cin.tie(0);
    cin>>n>>m;
    for(int i = 1;i<=m;++i){
        int x,y,z;
        cin>>x>>y>>z;
        e[i] = Edge(x,y,(i64)z);
    }
    Tr tr(1e5+10);
    kruskal(tr);
    i64 ans = 1e18;
    tr.dfs(1,0);

    for(int i =1 ;i<=m;++i){
        if(!use[i]){
            int lca = tr.lca(e[i].u,e[i].v);
            //找到路径上不等于e[i].w的最大边权
            i64 tmpa = tr.query(e[i].u,lca,e[i].w);
            i64 tmpb = tr.query(e[i].v,lca,e[i].w);
            //只在存在是更新答案
            if(max(tmpa,tmpb)>-INF){
                ans = min(ans,sum-max(tmpa,tmpb)+e[i].w);
            }
        }
    }
    cout<<(ans==1e18?-1:ans)<<"\n";
    return 0;
}
```





## 差分约束

在求最短路的过程中,dis[y]>dis[x]+w(x,y),要进行更新，但我们要的是最短路,所以不要更新，
最短路满足dis[y]<=dis[x]+w(x,y),与差分约束形式相同，
(1)求解未知数最大值 a-b<=c 连b到a的一条边,求最短路(作法合理性:因为对于每个点都会有最大值)
(2)求解未知数最小值 a-b<=c 连b到a的一条边,求最长路

```c++
const int maxn = 1e6+10;
int n,k;
struct ty{
	int t,next,l;
}edge[maxn];
int head[1024000],tot=0;
void addedge(int x,int y,int z){
	edge[++tot]={y,head[x],z};
	head[x]=tot;
}

int dis[maxn];
bool vis[maxn];
int cnt[maxn];
void spfa(){
	memset(dis,-inf,sizeof(dis));
	deque<int> q;
	dis[0]=0;
	q.push_back(0);
	vis[0]=1;
	while(!q.empty()){
		int x = q.front();
		q.pop_front();
		vis[x]=0;
		for(int i = head[x];i!=-1;i = edge[i].next){
			int y = edge[i].t;
			if(dis[y]<dis[x]+edge[i].l){
				dis[y]=dis[x]+edge[i].l;
				cnt[y] = cnt[x]+1;
				if(cnt[y]>=n+1){
					printf("-1");
					return;
				}
				if(vis[y]) continue;
				if(q.empty()) q.push_back(y);
                else{
                    if(dis[y]>dis[q.front()]) q.push_front(y);
                    else q.push_back(y);
                }
				vis[y]=1;
			}
		}
	}
	long long ans=0;
	for(int i =1;i<=n;++i) ans+=dis[i];
	printf("%lld",ans);
}

int main(){
	memset(head,-1,sizeof(head));
	scanf("%d%d",&n,&k);
	for(int i = 1;i<=k;++i){
		int x,a,b;
		scanf("%d%d%d",&x,&a,&b);
		if(x==1){
			addedge(a,b,0);
			addedge(b,a,0);
		}else if(x==2){//a-b<=-1
			addedge(a,b,1);
		}else if(x==3){//a-b>=0
			addedge(b,a,0);
		}else if(x==4){//a-b>=1
			addedge(b,a,1);//？
		}else if(x==5){//a-b<=0
			addedge(a,b,0);
		}
	}
	for(int i = 1;i<=n;++i) addedge(0,i,1);
	/*
	for(int i = 1;i<=cnt;++i){
		cout<<edge[i].t<<" "<<edge[i].next<<endl;
	}*/
	spfa();
	return 0;
}
```



## 二分图

### 判定(染色法)

```c++
bool bfs(int s){
    col[s]=1;
    queue<int>q;
    q.push(s);
    while(!q.empty()){
        int x = q.front();
        q.pop();
        for(auto y:g[x]){
            if(col[y]==-1){
                col[y] = col[x]^1;
                q.push(y);
            }else if(col[x]==col[y]) return 0;
        }
    }
    return 1;
}

memset(col,-1,sizeof col);
for(int i = 1;i<=n;++i){
	if(col[i]!=-1||g[i].size()==0) continue;
	bfs(i);
}
```



### 最大匹配(等于最小点覆盖)——KM算法

**O（$n^3$）**

N是左端的点的数量,m是右端的点的数量,e是边数

```c++
int n,m,e;
vector<int>g[maxn];
int match[maxn],vis[maxn];
inline bool dfs(int x){
    for(auto y:g[x]){
        if(vis[y]) continue;//已经访问过
        vis[y]=1;
        if(!match[y]||dfs(match[y])){
            match[y]=x;
            return 1;
        }
    }
    return 0;
}

signed main(){
    ios::sync_with_stdio(0);cin.tie(0);cout.tie(0);
    cin>>n>>m>>e;
    for(int i = 1;i<=e;++i){
        int x,y;
        cin>>x>>y;
        g[x].emplace_back(y);//x是左部分的节点,y是右部分的节点
    }
    i64 ans = 0;
    for(int i = 1;i<=n;++i){
        memset(vis,0,sizeof vis);
        if(dfs(i)) ans++;
    }
    cout<<ans<<'\n';
    return 0;
}
```

为什么x->y不会弄混节点，因为程序逻辑会确保左部节点只会尝试匹配右部节点,dfs确保都是从左部分节点开始遍历



## Jahnson

**全源最短路,让dij可以跑负权边**

```c++
const int maxn = 1e5+10;
struct ty{
    i64 t,l;
};
vector<ty>g[maxn];
struct ty2{
    i64 x,dis;
    bool operator<(const ty2&u)const{
        return dis>u.dis;
    }
};
int n,m;
bool vis[5002];
int t[5002];
i64 h[5002];
bool spfa(int s){
    queue<int>qq;
    memset(vis,0,sizeof vis);
    memset(h,63,sizeof h);
    h[s] = 0,vis[s]=1;
    qq.push(s);
    while(!qq.empty()){
        int u = qq.front();
        qq.pop();
        vis[u]=0;
        for(ty y:g[u]){
            int v = y.t;
            if(h[v]>h[u]+y.l){
                h[v] = h[u]+y.l;
                if(!vis[v]){
                    vis[v]=1;
                    qq.push(v);
                    t[v]++;
                    if(t[v]==n+1) return 0;
                }
            }
        }
    }
    return 1;
}
priority_queue<ty2> q;
i64 dis[5002];
void dij(int s){
    memset(dis,0x3f3f3f3f3f3f3f3f,sizeof dis);
    memset(vis,0,sizeof vis);
    dis[s]=0;
    q.push({s,0});
    while(!q.empty()){
        ty2 tmp = q.top();
        q.pop();
        if(vis[tmp.x]) continue;
        vis[tmp.x] =1;
        for(ty y:g[tmp.x]){
            if(dis[y.t]>dis[tmp.x]+y.l){
                dis[y.t]=dis[tmp.x]+y.l;
                q.push({y.t,dis[y.t]});
            }
        }
    }
}

int main(){
    ios;
    cin>>n>>m;
    for(int i = 1;i<=m;++i){
        int x,y,z;
        cin>>x>>y>>z;
        g[x].push_back({y,z});
    }
    for(int i = 1;i<=n;++i){
        g[0].push_back({i,0});
    }
    if(!spfa(0)){
        cout<<-1;
        return 0;
    }
    for(int u = 1;u<=n;++u){
        for(int i = 0;i<g[u].size();++i){
            g[u][i].l +=h[u]-h[g[u][i].t]; 
        }
    }
    for(int i = 1;i<=n;++i){//n遍dij
        dij(i);
        i64 ans = 0;
        for(int j = 1;j<=n;++j){
            if(dis[j]>=0x3f3f3f3f3f3f3f3f){
                ans+=j*(i64)1e9;
            }else ans += j*(dis[j]+h[j]-h[i]);
        }
        cout<<ans<<"\n";
    }
    return 0;
}
```



## 割点/割边(Tarjan)

**强联通**: 若一张有向图任取两点都可互相到达，称这张图是强联通的

**强联通分量 SCC(Strongly Connected Components)**:极大的强联通子图

对图进行dfs，被访问的节点构成搜索树(DFS生成树)

有向边分为4种

1.树边:访问节点走过的边

2.返祖边:指向祖先节点的边

3.横叉边:右子树节点指向左子树节点的边(被指向的不是当前节点的祖先)

4.前向边:指向子树节点的边

**返祖边与树边必构成环，横叉边可能与树边构成环**



 强联通分量的根:在搜索树终于到的第一个强联通分量的点x,其余节点在以x为根的子树中



### 割点

**Tarjan O(n+m)**

1.时间戳:节点x第一次被访问的顺序

2.追溯至 low[x]:从节点x除法，所能访问到的最早时间戳

1.访问x时，记录时间戳，入栈

2.枚举邻点:

​	case 1: y未被访问，对y深搜,会x时更新low值,尝试用low[y]更新low[x]

​	case2: y已经访问且在栈中,尝试用dfn[y]更新low[x]

​	case3: y已经搜索完毕，无需进行额外操作

3.结束访问时，记录SCC，只有遍历完一个SCC,才可以出栈.

更新low值的意义，避免SCC节点提前出栈

```c++
constexpr int maxn = 2e5+10;
vector<int>g[maxn];
int dfn[maxn],low[maxn],tot;
int st[maxn],instk[maxn],top;
int scc[maxn],siz[maxn],cnt;
void tarjan(int x){
    //入x时,记录时间戳，入栈
    dfn[x]=low[x]=++tot;
    st[++top]=x;
    instk[x]=1;
    for(int y:g[x]){
        if(!dfn[y]){//y尚未被访问
            tarjan(y);
            low[x]=min(low[x],low[y]);
        }else if(instk[y]) low[x] = min(low[x],dfn[y]);//若y已经访问且在栈中
    }
    //离开x时，记录SCC
    if(dfn[x]==low[x]){//若x是scc的根
        int y;
        cnt+=1;
        do{
            y = st[top--];
            instk[y]=0;
            scc[y] = cnt;//scc编号
            ++siz[cnt];//scc大小
        }while(y!=x);
    }
}
```





### **割边**

割边:对于一个无向图,如果删除一条边后，图中的连通块个数增加，那么这条边称为桥或者割边

割边判定法则:

当搜索树存在x的一个子节点y,满足low[y]>dfn[x] $\Rightarrow$ $(x,y)$ 是割边

low[y]>dfn[x],说明从y出发,在不经过(x,y) 这条边的前提下，不管走那条边，都无法到达x或者更早访问的节点.故删除 $(x,y)$ ，以y为根的子树subtree(y)也就断开了.即**环外的边割的断**

反之,若$low[y] \leq dfn[x]$ ,则说明y绕行其他边到达x或者更早访问的节点,(x,y)就不在是割边了.即**环内的边割不断**

割点判定: $low[y] \geq dfn[x]$，允许走 (x,y)的反边更新low值

割边判定: $low[y]>dfn[x]$，不允许走 (x,y)的反边更新low值

 

有重边时,设立一个标记判断是否已有一条边抵达父节点，标记后再访问到父节点时正常更新

```c++
int low[maxn], dfn[maxn], idx;
bool isbridge[maxn];//如果等于true,说明(father[v],v)是桥
vector<int> g[maxn];
int cnt_bridge;
int father[maxn];

void tarjan(int u, int fa) {
    bool flag = false;
    father[u] = fa;
    low[u] = dfn[u] = ++idx;
    for (const auto &v : g[u]) {
        if (!dfn[v]) {
            tarjan(v, u);
            low[u] = min(low[u], low[v]);
            if (low[v] > dfn[u]) {
                isbridge[v] = true;
                ++cnt_bridge;
            }
        } else {
            if (v != fa || flag)
                low[u] = min(low[u], dfn[v]);
            else
                flag = true;
        }
    }
}
```

### 边(点)双联通分

在一个联通无向图中,对于 $u$ ,$v$,无论删除哪条边(删一条),不能使它们不连通，就称$u$,$v$边双连通

同理点双就是删除一个点

先用Tarjan求出所有的桥(割边)，再DFS求出双连通分量



```cpp
#include <bits/stdc++.h>
using namespace std;
const int MAXN = 200000 + 5; // 根据你的需求调整
int n, m;
vector<int> g[MAXN];

int low[MAXN], dfn[MAXN], idx;
bool isbridge[MAXN]; // 如果 true, (father[v], v) 是桥（约定：以子点标记）
int father_arr[MAXN];
int cnt_bridge;

int comp[MAXN]; // comp[u] = 边双联通分量 id (1..compCnt)
int compCnt;

void tarjan(int u, int fa) {
    bool flag = false;
    father_arr[u] = fa;
    low[u] = dfn[u] = ++idx;
    for (const auto &v : g[u]) {
        if (!dfn[v]) {
            tarjan(v, u);
            low[u] = min(low[u], low[v]);
            if (low[v] > dfn[u]) {
                isbridge[v] = true; // 标记 (u,v) 为桥，存为 isbridge[child]=true
                ++cnt_bridge;
            }
        } else {
            if (v != fa || flag)
                low[u] = min(low[u], dfn[v]);
            else
                flag = true;
        }
    }
}

// 在跳过桥边的情况下给节点染色（得到边双连通分量 id）
void dfs_comp(int u, int id) {
    comp[u] = id;
    for (int v : g[u]) {
        if (comp[v] != 0) continue;
        // 判断边 u-v 是否是桥：
        // 根据你的标记规则，若 father[v]==u 且 isbridge[v] 为 true，
        // 或者 father[u]==v 且 isbridge[u] 为 true，则该无向边是桥
        bool edge_is_bridge = false;
        if (father_arr[v] == u && isbridge[v]) edge_is_bridge = true;
        if (father_arr[u] == v && isbridge[u]) edge_is_bridge = true;
        if (edge_is_bridge) continue; // 跳过桥
        dfs_comp(v, id);
    }
}

// 构造桥树（组件间图，节点为 comp id，边为原来的桥）
vector<vector<int>> build_bridge_tree() {
    vector<unordered_set<int>> tmp(compCnt + 1); // 用 set 避免重复边
    for (int u = 1; u <= n; ++u) {
        for (int v : g[u]) {
            if (comp[u] == comp[v]) continue;
            tmp[comp[u]].insert(comp[v]);
        }
    }
    vector<vector<int>> tree(compCnt + 1);
    for (int i = 1; i <= compCnt; ++i) {
        for (int j : tmp[i]) tree[i].push_back(j);
    }
    return tree;
}

void reset_all(int N) {
    n = N;
    for (int i = 1; i <= n; ++i) {
        g[i].clear();
        dfn[i] = low[i] = 0;
        isbridge[i] = false;
        father_arr[i] = 0;
        comp[i] = 0;
    }
    idx = 0; cnt_bridge = 0; compCnt = 0;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // 示例输入格式：n m, 然后 m 行边 u v (1-indexed)
    if (!(cin >> n >> m)) return 0;
    reset_all(n);
    vector<pair<int,int>> edges;
    for (int i = 0; i < m; ++i) {
        int u, v; cin >> u >> v;
        g[u].push_back(v);
        g[v].push_back(u);
        edges.emplace_back(u,v);
    }

    // 1) run tarjan for all components (forest)
    for (int i = 1; i <= n; ++i)
        if (!dfn[i])
            tarjan(i, -1);

    // 2) build components by DFS, skipping bridge edges
    for (int i = 1; i <= n; ++i) {
        if (comp[i] == 0) {
            ++compCnt;
            dfs_comp(i, compCnt);
        }
    }

    // 输出：每个点所在组件 id, 组件数量, 桥的数量与列表
    cout << "edge-biconnected components count = " << compCnt << "\n";
    for (int i = 1; i <= n; ++i) cout << comp[i] << (i==n?'\n':' ');
    cout << "bridge count = " << cnt_bridge << "\n";
    // 列出桥（按你标记法）
    for (int v = 1; v <= n; ++v) {
        if (isbridge[v] && father_arr[v] != -1) {
            cout << father_arr[v] << " " << v << "\n";
        }
    }

    // 3) 构造桥树（以组件为节点）
    auto tree = build_bridge_tree();
    // 输出树（组件之间的邻接）
    cout << "bridge-tree adjacency (component ids):\n";
    for (int i = 1; i <= compCnt; ++i) {
        cout << i << ":";
        for (int j : tree[i]) cout << ' ' << j;
        cout << '\n';
    }
    return 0;
}

```

判断两点是否在同一连通分量`comp[a] == comp[b]`?

桥树是把割边作为树边的树(有可能是森林)





## 2-SAT

简单理解 : $n$ 个布尔方程,每个方程和两个变量相关，判断是否有解，如有求一种方案

|         原式         |                             建图                             |
| :------------------: | :----------------------------------------------------------: |
|   $\neg a \lor b$    |       $a\rightarrow b$ 和 $\neg b \rightarrow \neg a$        |
|      $a \lor b$      | $\neg a \rightarrow b$ 和 $\neg b\rightarrow a$  (a不成立，则b成立) |
| $\neg a \lor \neg b$ |        $a\rightarrow \neg b$ 和 $b\rightarrow \neg a$        |

需要 2-SAT 问题都需要找如 $a$ **不成立** , 则 $b$ **成立** 的关系

两个点在同一强连通分量,则这两个点代表的条件要么都满足要么都不满足



建图后，用Tarjan缩点找SCC,判断对于**任意**布尔变量 $a$ ，如果 $a$ 和 $\neg a$ 都在一个SCC中，，那么 **无解**

方案构建:

- ```cpp
  for(int i = 1;i<=n;++i){
      if(scc[i]<scc[i+n]){
          ans.emplace_back(i);
      }
  }
  ```

## 网络流(Flow)



**最大流等于最小割**

割:集合 $S$ 和 $T$ 中的节点向另一集合中的点的连边个数 

$s$点到$t$点不存在路径 $\iff$ 存在任何一个大小为$0$的$s-t$割

求最多有多少**不相交**的路径=最小割(相当于求出上界)

带权图可以拆成权值为$1$的重边,每次记录经过路径的次数，就可以转化成最多不相交路径问题



**最大闭权子图大小=原图正权和-新图最大流**

新图构造方法:

原点 $S$ 向所有正权点来岸边，容量为$w_i$

所有负权点向汇点$T$连边，容量为$-w_i$

原图中的边保持不变，容量为$INF$



二分图上跑费用流复杂度是 $O(n\cdot m\cdot logn)$



### 最大流

#### Edmonds–Karp

**$O(n*m^2)$**

建立反边，不断找最短路求解最大流



```cpp
constexpr int maxn = 250,MAXN = 210;
constexpr i64 INF = 1e17;
int n,m,s,t;
struct edge{
    int from,to,cap;
    i64 flow;
    edge(int u,int v,int c,int f):from(u),to(v),cap(c),flow(f){}//成员列表初始化
};
struct EK{
    int now;
    vector<edge> edges;
    vector<int>g[maxn];
    int a[maxn],p[maxn];// a：点 x -> BFS 过程中最近接近点 x 的边给它的最大流
                        // p：点 x -> BFS 过程中最近接近点 x 的边
    void init(int n){
        for(int i = 0;i<=n;++i){
            vector<int> tmp;
            g[i].swap(tmp);
        }
        edges.clear();
    }

    void addedge(int from,int to,int cap){
        edges.push_back(edge(from,to,cap,0));
        edges.push_back(edge(to,from,0,0));
        now = edges.size();
        g[from].push_back(now-2);
        g[to].push_back(now-1);
    }

    i64 maxflow(int s,int t){
        i64 flow = 0;
        for(;;){
            memset(a,0,sizeof a);
            queue<int> q;
            q.push(s);
            a[s] = 1e18;
            while(!q.empty()){
                int x = q.front();
                q.pop();
                for(auto i:g[x]){
                    edge &y = edges[i];
                    if(!a[y.to]&&y.cap>y.flow){
                        p[y.to] = i;//i是最接近y.to的边
                        a[y.to] = min(a[x],y.cap-y.flow);
                        q.push(y.to);
                    }
                }
                if(a[t]) break;//如果汇点接受了流，退出BFS
            }
            if(!a[t]) break;//如果汇点没有接受流，说明原点和汇点不在同一连通分量上
            for(int u = t;u!=s;u = edges[p[u]].from){//通过u追寻BFS过程中 s->t的路径
                edges[p[u]].flow+=a[t];//增加路径上的边的flow值
                edges[p[u]^1].flow-=a[t];//减小反向路径的flow值
            }
            flow+=a[t];
        }
        return flow;
    }
};
```



#### Dinic

重复执行直到找不到阻塞流:

​	1.构造 level graph

​	2.找到阻塞流

​	3.更新residual graph，添加反向遍，删除一些边



**$O(n^2\cdot m)$**

在**二分图**中，时间复杂度为 $O(m\sqrt n)$

```c++
struct MF{
    struct edge{
        i64 v,cap,nxt;
    }e[12000];

    int head[maxn],idx=1;//idx=1 从2,3开始配对
    int n,S,T;
    int dep[maxn],cur[maxn];
    void init(){
        memset(head,0,sizeof head);
        idx = 1;
    }

    void addedge(int u,int v,int w){
        e[++idx] = {v,w,head[u]};
        head[u] = idx;
        e[++idx] = {u, 0, head[v]};  // 添加反向边，容量初始为 0
        head[v] = idx; 
    }

    bool bfs(){//对点分层,找增广路
        queue<int> q;
        memset(dep,0,sizeof dep);
        dep[S]=1;
        q.push(S);
        while(!q.empty()){
            int u = q.front();
            q.pop();
            for(int i = head[u];i;i = e[i].nxt){
                int v = e[i].v;
                if(!dep[v]&&e[i].cap){
                    dep[v] = dep[u]+1;
                    q.push(v);
                    if(v==T) return 1;
                }
            }
        }
        return 0;
    }

    i64 dfs(int u,i64 mf){//多路增光
        if(u==T) return mf;
        i64 sum = 0;
        for(int i= cur[u];i;i = e[i].nxt){
            cur[u] = i;//当前弧优化
            int v = e[i].v;
            if(dep[v]==dep[u]+1&&e[i].cap){
                i64 f = dfs(v,min(mf,e[i].cap));
                e[i].cap-=f;
                e[i^1].cap+=f;//更新残留网络
                sum+=f;//累加u的流出流量
                mf-=f;//减少u的剩余流量
                if(mf==0) break;//余量优化
            }
        }
        if(sum==0) dep[u]=0;//残枝优化
        return sum;
    }

    i64 dinic(){
        i64 flow = 0;
        while(bfs()){
            memcpy(cur,head ,sizeof head);//将head赋值给cur，注意两个数组要一样大
            flow+=dfs(S,1e18);
        }
        return flow;
    }
};
```



### 最小费用最大流



#### 基于EK

```cpp
constexpr int maxn = 200;
int head[maxn],idx = 1,s,t;
struct ty{
    int nex,t;
    i64 v,c;//容量,花费
}e[maxn<<2];

void addedge(int from,int to,int v,int cost){
    e[++idx] = {head[from],to,v,cost};
    head[from] = idx;
}
int dis[maxn],pre[maxn],incf[maxn];
bool vis[maxn];
bool spfa(){
    memset(dis,0x3f,sizeof dis);
    queue<int> q;
    q.push(s);
    dis[s]= 0;
    incf[s]=1e9,incf[t] = 0;
    while(!q.empty()){
        int u = q.front();
        q.pop();
        vis[u]=0;
        for(int i = head[u];i;i = e[i].nex){
            int v = e[i].t,w =e[i].v,c = e[i].c;
            if(!w||dis[v]<=dis[u]+c) continue;
            dis[v] = dis[u]+c;
            incf[v] = min(w,incf[u]);
            pre[v] = i;
            if(!vis[v]){
                q.push(v);
                vis[v]=1;
            }
        }
    }
    return incf[t];
}
int maxflow,mincost;
void update(){
    maxflow+=incf[t];
    for(int u = t;u!=s;u = e[pre[u]^1].t){
        e[pre[u]].v-=incf[t];
        e[pre[u]^1].v+=incf[t];
        mincost+=incf[t]*e[pre[u]].c;
    }
}
void MCMF(){
    while(spfa()) update();
}
```



#### Jashon+Dij

```cpp
template<typename T> struct MCFGraph{
    struct Edge{
        int v;
        T c,f;
        Edge(int v,T c,T f):v(v),c(c),f(f){}
    };  
    const int n;
    vector<Edge> e;
    vector<vector<int>> g;
    vector<i64> h,dis;
    vector<int> pre;

    bool dijkstra(int s,int t){
        dis.assign(n,numeric_limits<i64>::max());
        pre.assign(n,-1);
        priority_queue<pair<i64,int>,vector<pair<i64,int>>,greater<pair<i64,int>>> que;
        dis[s]=0;
        que.emplace(0,s);
        while(!que.empty()){
            i64 d = que.top().first;
            int u = que.top().second;
            que.pop();
            for(int i:g[u]){
                int v=e[i].v;
                T c = e[i].c;
                T f=e[i].f;
                if(c>0&&dis[v]>d+h[u]-h[v]+f){
                    dis[v]=d+h[u]-h[v]+f;
                    pre[v]=i;
                    que.emplace(dis[v],v);
                }
            }
        }
        return dis[t]!=numeric_limits<i64>::max();
    }
    MCFGraph(int n):n(n),g(n){}
    void addEdge(int u,int v,T c,T f){//c:流量 f:费用
        g[u].push_back(e.size());
        e.emplace_back(v, c, f);
        g[v].push_back(e.size());
        e.emplace_back(u, 0, -f);
    }
    pair<T,i64> flow(int s,int t){
        T flow=0;
        i64 cost =0;
        h.assign(n,0);
        while(dijkstra(s,t)){
            for(int i = 0;i<n;++i) h[i]+=dis[i];
            T aug = numeric_limits<T>::max();
            for(int i = t;i!=s;i = e[pre[i]^1].v) aug = min(aug,e[pre[i]].c);
            for(int i = t;i!=s;i = e[pre[i]^1].v){
                e[pre[i]].c-=aug;
                e[pre[i]^1].c+=aug;
            }
            flow+=aug;
            cost+=i64(aug*h[t]);
        }
        return make_pair(flow,cost);
    }

};

using mcf=MCFGraph<i64>;

signed main(){
    ios::sync_with_stdio(0);cin.tie(0);
    int n;
    cin>>n;
    mcf g(2*n+2);//要多开一些点
    for(int i =1;i<=n;++i){
        int r;cin>>r;
        g.addEdge(0,i,r,0);
        g.addEdge(i+n,2*n+1,r,0);
    }
    int p,a,f,b,s;
    cin>>p>>a>>f>>b>>s;
    constexpr int inf = 2e9;
    for(int i = 1;i<=n;++i){
        g.addEdge(0,i+n,inf,p);
        if(i+1<=n) g.addEdge(i,i+1,inf,0);
        if(i+a<=n) g.addEdge(i,i+n+a,inf,f);
        if(i+b<=n) g.addEdge(i,i+n+b,inf,s);
    }
    cout<<g.flow(0,2*n+1).second<<"\n";
    return 0;
}
```





### 切糕

原始问题:

$|f(x,y)-f(x\pm1,y)|\leq D\\|f(x,y)-f(x,y\pm1)|\leq D\\D\geq 0$

求$\sum v[i][j][f(i,j)]$ 最小

**solution:**对于 $|x_1-x_2|+|y_1-y_2|=1$ 之间的点连一条容量为**inf**的边，对于下一层点连一条容量为$v[i][j][k]$ 的边 $(i,j,k)\rightarrow (i,j,k+1)$,原点向第一层连容量为**inf**的边,最下面一层向汇点连容量为$v[i][j][k]$ 的边，跑**最大流**即可



# 数学

## 数学小结论

**a mod b <=a/2  (a>b)
对于斐波那契数列，相邻元素的gcd都为1**

设 $f(x)$ 为 $x$ 的最小素因子，x是任意非素数，那么 $x-f(x)$ 必定是偶数

如果一个数的进行 $gcd$操作 有变化，最多变化 $logV$ 次

对于任意整数 $a>0$, $a^{2^i}$ = $(a^{2^{i-1}})^2$ 是完全平方数

$a^x \equiv a^{x(mod\ p-1)}\ (mod\ p)$ 对于 $a\not \equiv 0\ (mod\ p)$ 且 $p$ 是素数

欧拉定理 : 若 $\gcd(a,m)=1$，则 $a^{\varphi(m)}\equiv 1\pmod m$。于是同样有$ a^{x}\equiv a^{\,x\bmod \varphi(m)}\pmod m.$

对形式幂级数 :
$$
\frac{1}{1-x^n}=\frac{1+x^n+x^{2n}+...+x^{(k-1)n}}{1-x^{nk}}
$$

$(a+b)^n=\sum_{i=0}^{n}\ C(n,i)\ a^i\cdot b^{n-i}$

对于 $\lceil \frac{y}{x}\rceil = r $ ,这种形式的函数是通过求解不等式获得值：

- $r-1< \frac{y}{x} \leq r$
- $\frac{y}{r}\leq x<\frac{y}{r-1}$

如果 $x$ 要求是整数那么可以在两侧套上取整,把区间变成闭的[L,R]，会发现$2\cdot L> R$ 

恒等式 $\lceil \frac{NB}{W} \rceil = \lceil \frac{N}{\lfloor \frac{W}{B} \rfloor} \rceil$  ,实际例子 N:你需要放的书本总数 , B:每本书的宽度 ,W:每一个书架的宽度,目标是计算需要多少书架，LHS：总宽度/每本宽度,RHS: 书本总数/一个书架可以放多少书

$\lceil \frac{a}{b} \rceil =\lfloor \frac{a-1}{b} \rfloor +1$

对于取整嵌套的，先处理外层，再处理内层

$(x\ \&\ y)+(x\ |\ y) = x+y$

$x|y=(x\oplus y)+(x\& y)=(x\oplus y)\oplus (x\& y)$



曲棒球恒等式 : $\sum_{i=m}^{n} \binom{i}{a}=\binom{n+1}{a+1} - \binom{m}{a+1}$








## 仿射函数

维护一次函数复合函数可以用系数构造矩阵，假设 $f(x) = ax+b,\quad g(x) = cx+d$ 

则 $(f\circ g)(x) = f(g(x)) = a(cx+d)+b = (ac)x+(ad+b)$,那么我们可以用下列方式表示函数的复合
$$
(a_1,b_1) \circ (a_2,b_2) \mapsto (a_1a_2,a_1b_2+b_1)
$$
我们只要维护两个系数就可以维护函数的复合，维护全局系数 $(A,B)$ ,初始值为 $(1,0)$ (恒等变换) 

复合类似于于左乘矩阵，求逆也是类似的。具体的，现有一次函数复合 $F(x)=f_1(f_2(f_3(x)))$ ,现在我想得到 $f_1(x)$ ,那么我可以 $F\circ g(x)= f_1(f_2(f_3(g(x))))$  , 其中 $g(x) = f_3^{-1} (f_2^{-1}(x))\quad f_3^{-1} 是 f_3的逆映射$



还有一些其它的方法求前缀复合的办法

记从步骤 $j$ 到 $n$ 的复合线性映射为
$$
\Phi_{j\to n}(x)

  \;=\;

  A_{j}\cdot A_{j+1}\cdots A_{n}\;x \;+\;

  \sum_{t=j}^{n} \Bigl(B_{t}\,\prod_{u=t+1}^{n}A_{u}\Bigr).
$$
特别地，如果记
$$
S_A[j] = \prod_{i=j}^{n} A_i,

  \qquad

  S_B[j] = \sum_{i=j}^{n} \Bigl(B_i \,\prod_{u=i+1}^{n} A_u\Bigr),
$$
那么
$$
  f[n]

  = \Phi_{k+1\to n}\bigl(f[k]\bigr)

  = S_A[k+1]\;f[k]\;+\;S_B[k+1].
$$


由上式解得
$$
  f[k]

  = \frac{\,f[n] - S_B[k+1]\,}{\,S_A[k+1]\,}.
$$


这就是从后缀“逆推”到任意前缀 $k$ 的封闭形式。



```cpp
// 边界：在“第 n+1 步”之前，复合当成恒等映射
S_A[n+1] = 1;
S_B[n+1] = 0;

// 反向累积
for (int i = n; i >= 1; --i) {
    S_A[i] = A[i] * S_A[i+1];
    S_B[i] = B[i] + A[i] * S_B[i+1];
}
```

查询任意 k 时 $f[k]= \bigl(f[n] - S_B[k+1]\bigr)\,/\,S_A[k+1]$

 追加新映射 $(A_{n+1},B_{n+1})$ 时，只需从后往前更新一次即可（或增大数组，按需重算尾部）。

### 动态区间更新／查询（可修改中间 $(A_i,B_i)$）

若需要支持在任意位置更新 $(A_i,B_i)$，并仍能快速查询任意 $k\to n$ 后缀复合，可用**线段树**或**树状数组 + 矩阵分解**。

- **段树节点** 存储一个线性变换对 $(A, B)$，语义为“该区间内复合映射”。

- 合并两个子区间 $[L,M]$ 和 $[M+1,R]$：

$$
(A_L,B_L)\;\circ\;(A_R,B_R)

​    = \bigl(A_R \cdot A_L,\;B_R + A_R \cdot B_L\bigr).
$$

- 查询 $[k+1, n]$ 就能在 $O(\log n)$ 内得到整体后缀 $(S_A[k+1],\,S_B[k+1])$，再用上面的逆映射求出 $f[k]$。





## O(n)求1-n逆元

设 $p = k\cdot i+r,\quad k=\lfloor \frac{p}{i} \rfloor, \quad r = p%i $

那么$k\cdot i+r\equiv 0\pmod{m}$

两边同时乘上 $i^{-1}\cdot r^{-1}$ ,移项得到 $i^{-1}=-k\cdot r^{-1} \pmod{m}$

带入$k,r$ 得到 $inv[i] = (p-\lfloor \frac{p}{i} \rfloor)\cdot inv[p\%i]$ $\%p$

```cpp
inv[1]=1;
for(int i = 2; i <= n; i++){
	inv[i] = 1LL*(mod-mod/i)*inv[mod % i]%mod;
}
```



## 数论分块

用于解决 $f(n) = \sum_{i=1}^{n} g(i)\times\lfloor\frac{n}{i}\rfloor$ 这类问题

往往会注意到 $\lfloor\frac{n}{i}\rfloor$ 最多只有 $\sqrt{n}$ 种,或者类似的结论

$eg.求\sum_{i=1}^{n}\lfloor\frac{n}{i}\rfloor$

```cpp 
for(int l = 1, j; l <= n; l = r + 1) {
    r = n / (n / r);
    res += (preg[r] - preg[l - 1]) * (n / l) * (r - l + 1);
}
```



## 斐波那契计算(比矩阵计算快)

快速倍增算法直接利用如下递归关系计算$\ (F(n)\ ) 与 \ (F(n+1)\ )：$  
$$
\begin{aligned}

   &F(2k) = F(k) \times [2F(k+1)-F(k)] \mod mod,\\[1mm]

   &F(2k+1) = F(k+1)^2+F(k)^2 \mod mod.

   \end{aligned}
$$


```cpp
// 快速倍增算法：返回 {F(n), F(n+1)} (模 mod)
inline pair<int, int> fibPair(int n) {
    if(n == 0) return {0, 1};
    auto p = fibPair(n >> 1);
    int a = p.first, b = p.second;
    // 为防止负数，加上 mod 后再取 mod
    int c = (int)(1LL * a * (((2LL * b - a) % mod + mod) % mod) % mod);
    int d = (int)((1LL * a * a + 1LL * b * b) % mod);
    if(n & 1) return {d, (c + d) % mod};
    return {c, d};
}
```



辗转相除法的时间复杂度是 **log** 的

## 欧拉筛(质数筛)

```c++
for(int i=2;i<=n;++i){
    if(v[i]==0){
        v[i]=i;
        prime[++cnt]=i;
    }
    //如果没有筛过,记录素数
    for(int j = 1;j<=cnt;++j){
        if(prime[j]>v[i]||i*prime[j]>n) break;
        //i有比prime[j]小的因子,那>prime[j]的因子就没有意义
        v[i*prime[j]] = prime[j];
        //筛去这个合数
    }
}
```







### 快速预处理质因数

```c++
for(int i = 2;i<maxn;++i){
    if(v[i]==0){prime.emplace_back(i);v[i]=i;}
    for(auto j:prime){if(j>v[i]||i*j>=maxn) break;v[i*j]=j;}
}
for(int i = 1;i<maxn;++i){
    int x = i;
    while(x>1){
        int y = v[x];
        factor[i].emplace_back(y);
        while(x%y==0) x/=y;
    }
}
```







## 扩展欧几里得

**任意两个不全为零的整数a,b,存在两个整数x,y, s.t. ax+by=gcd(a,b)**

**x = x+b/gcd(a,b) \*k** **是方程的通用解**

```c++
i64 gcd_ex(i64 a,i64 b,i64 &x,i64 &y){
    if(b==0){x=1;y=0;return a;}
    i64 d = gcd_ex(b,a%b,y,x);//执行完后y = xi+1,x = yi+1
    y = y-a/b*x;//递推公式是yi=xi+1-(a/b)*yi+1
    return d; //最终返回gcd
}
```

- 扩展欧几里得求整数 $p (\mod r)$ 的逆元

  **条件:**  $gcd(p,r) = 1$

- ```cpp
  i64 modinv(i64 p,i64 mod){//p:想求逆元的数,mod:满足gcd(p,mod)=1的模数
      p%=mod;
      if(p < 0) p += mod;
      i64 x,y;
      i64 g = exgcd(p,mod,x,y);
      if(g != 1) return -1;
      p%=mod;
    	if(x < 0) x += mod;
      return x;
  }
  ```



## Lucas定理

```cpp
long long Lucas(long long n, long long k long long p) {
  if (k == 0) return 1;
  return (C(n % p, k % p, p) * Lucas(n / p, k / p, p)) % p;//C(n,k,p)是较小规模组合数
}
```





## BSGS(求解离散对数问题)

>已知 $a,b,m$, 求最小的$x$, 使
>
>​						$a^x \equiv b\ (mod\  m)$
>
>这就是 **离散对数问题**

 把 $x$ 拆成 $x=i\cdot b+j$ , $n=\sqrt{m}$

代入: $a^{in+j}\equiv b\ (mod\ m)\implies a^{in}\cdot a^j\equiv b\ (mod\ m)$

得到: $a^j\equiv b\cdot(a^{-n})^i\ (mod\ m)$

于是分两步第一步预处理婴儿步算所有可能的 $a^j$ ($j$ 从 $0$ 到 $n-1$)

第二步枚举 $i$

复杂度 $O(\sqrt m)$

```cpp
constexpr i64 MOD = 1000000007;

// 快速幂：计算 a^e mod MOD
i64 qp(i64 a, i64 e) {...}

// 逆元：a^{-1} mod MOD，要求 gcd(a, MOD) == 1
i64 inv(i64 a) {
    i64 b = MOD, u = 1, v = 0;
    a %= MOD;
    if (a < 0) a += MOD;
    while (b) {
        i64 t = a / b;
        a -= t * b; swap(a, b);
        u -= t * v; swap(u, v);
    }
    // 此时 a = gcd(原a, MOD)，若不为 1 说明无逆元，按需处理
    if (u < 0) u += MOD;
    return u;   // 返回 a 在模 MOD 下的逆元
}

// BSGS：求最小 x >= 0 使得 a^x ≡ b (mod MOD)，若无解返回 -1
// 前提：gcd(a, MOD) == 1（否则需要扩展 BSGS）
i64 BSGS(i64 a, i64 b) {
    a %= MOD;
    b %= MOD;
    if (MOD == 1) return 0;
    if (b == 1 % MOD) return 0;   // x = 0 即可
    const i64 n = (i64) sqrtl((long double)MOD) + 1;
    // baby steps: 预处理 a^j
    unordered_map<i64, i64> table;
    table.reserve(n * 2);
    table.max_load_factor(0.7f);
    i64 baby = 1 % MOD;
    for (i64 j = 0; j < n; ++j) {
        if (!table.count(baby)) {
            table[baby] = j;  // 记录 a^j -> j
        }
        baby = (i128)baby * a % MOD;
    }
    // giant steps: 从 b 开始，每次乘 a^{-n}
    i64 a_n = qp(a, n);       // a^n
    i64 a_n_inv = inv(a_n);   // (a^n)^{-1}

    i64 cur = b % MOD;
    for (i64 i = 0; i <= n; ++i) {
        auto it = table.find(cur);
        if (it != table.end()) {
            i64 j = it->second;
            i64 x = i * n + j;
            return x;         // 找到解
        }
        // 往前走一个“巨人步”：乘以 a^{-n}
        cur = (i128)cur * a_n_inv % MOD;
    }
    return -1;  // 无解
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    i64 a, b;
    while (cin >> a >> b) {
        i64 x = BSGS(a, b);
        if (x == -1) cout << "no solution\n";
        else cout << x << "\n";
    }
    return 0;
}
```





## 中国剩余定理

### 两个方程

在**模数不互质**的情况下,设两个方程分别是 $x \equiv a_1(mod\ m1)$,$x \equiv a_2(mod\ m2)$ ,将他们转化为不定方程

$x=m_1p+a_1=m_2q+a_2$,其中 $p$ ,$q$ 是整数，则有 $m_1p-m_2q = a_2-a_1$,有，有裴蜀定理，当 $a_2-a_1$ 不能被 $gcd(m1,m2)$ 整除时，无解。

其它情况可以通过扩展欧几里得算出一组可行解 $(p,q)$ ，原方程组的解为 $x \equiv b(mod\ M)$ ,其中 $b=m_1p+a_1,M = lcm(m1,m2)$



$Eg.$ 设存在方程$v_xt_y-v_yt_x=c$,其中 $v_x$,$v_y$ 已知，且保证 $g = gcd(v_x,v_y)|c$, 首先调用扩展欧几里得，

得到$s$, $t$,满足  $v_ys+v_xt = g$ ,

首先构造出一组特解 $ k_0 = s\cdot\frac{c}{g}$ , $l_0 = -\,t\cdot\frac{c}{g}$ , 使得 $v_x\,\ell_0 - v_y\,k_0 = c$,

那么通解形式为
$$
k = k_0 + \frac{v_x}{g}\,u,\quad
    \ell = \ell_0 + \frac{v_y}{g}\,u,\quad u\in\mathbb{Z}.
$$


$Remark$
$$
对于方程Ak+Bl=c的通解形式为\\
\boxed{
\begin{cases}
k = k_0 + \dfrac{B}{g}\,u,\\[6pt]
\ell = \ell_0 - \dfrac{A}{g}\,u,
\end{cases}
\quad u\in\mathbb{Z},g = gcd(A,B).
}
\\其中k_0,l_0为特解
$$








## Matrix

矩阵可逆的充要条件:

都是等价条件

- A是方阵

- $det(A) \neq 0$ 
- A的秩为 $n$
- A的列向量(或者行向量) 线性无关

矩阵求逆方法:

1.Gauss-Jordan elimination

将 $A$ 与单位矩阵 $I$ 拼成增广矩阵 $[A|I]$ ，对增广矩阵进行初等行变换，使坐班部分变为单位矩阵，右半部分就是 $A^{-1}$

### 矩阵乘法

```c ++
vector<vector<int>> mul(vector<vector<int>> a, vector<vector<int>> b) {
    int n = a.size();
    int m = a[0].size();
    int p = b[0].size();
    vector<vector<int>> c(n, vector<int>(p, 0));
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < p; ++j) {
            for (int k = 0; k < m; ++k) {
                c[i][j] += a[i][k] * b[k][j];
            }
        }
    }
    return c;
}
```



### 矩阵快速幂

```c++
vector<vector<int>> qp(vector<vector<int>> a, i64 k) {
    int n = a.size();
    // 初始化单位矩阵
    vector<vector<int>> res(n, vector<int>(n, 0));
    for (int i = 0; i < n; ++i) {
        res[i][i] = 1;
    }
    while (k > 0) {
        if (k & 1) {
            res = mul(res, a);
        }
        a = mul(a, a);
        k >>= 1; 
    }
    return res;
}
```



### 高斯消元

#### 求阶梯型XOR版本

**非bieset优化版本**

```cpp
void GaussElimination(vector<vector<int>> &matrix){ //pivot第一个非0元素
    int n = matrix.size(), m = matrix[0].size(); //n行m列矩阵
    int row = 0;  //当前处理的阶梯型指针
    for(int i = 0; i < m && row < n; ++i){ // 在 r..n-1 行里找第一个 matrix[cur][i] == 1
        int cur = row;
        while(cur < n && matrix[cur][i] == 0) ++cur;
        if(cur >= n) continue;        // 整列全 0，只 advance 列，不动行
        if(cur != row) swap(matrix[cur], matrix[row]);// 找到 pivot，就 swap 到第 r 行
        // 用第 r 行消掉其他行第 i 列的 1
        for(int j = 0; j < n; ++j){
            if(j != row && matrix[j][i]){
                for(int k = i; k < m; ++k){
                    matrix[j][k] ^= matrix[row][k];
                }
            }
        }
        ++row;    // 只有真正找到了 pivot，才算固定一行
    }
}
```

bitset优化只要把`for(k i-m)`那一行直接用bitset整行XOR即可

如果我们想按照原方程行的顺序输出矩阵，我们可以记录一个`pivot_col`,在每次`swap(matrix[cur], matrix[row])` 之后加一句 `pivot_col[row]=i` 即可

高斯消元化成阶梯型矩阵，主元(每行第一个非0数)在第k列，意味着 $x_k$ 被解出



#### Bitset做高斯消元

模拟做,每次插入一条方程,插入过程中同时完成高斯消元，最终得到的是对角矩阵

```cpp
const int MAXLOG = 60;   // Ai <= 1e18 < 2^60
bitset<MAXLOG> ha[MAXLOG]; // 线性基每一行
int hc[MAXLOG]; 
auto insert = [&](bitset<N> a, int c) {
    for (int bit = 0; bit < N; bit++) {
        if (a.test(bit)) { // 如果当前位是 1
            if (!ha[bit].any()) { // 如果该位还没有主元（即找到了一个新的线性无关方程）
                // 1. 向后消元 (Jordan Elimination)：
                // 用当前行消去后面行中该位为 1 的部分，保持对角化性质
                for (int rua = bit + 1; rua < N; rua++) {
                    if (ha[rua].any() && a.test(rua)) {
                        a ^= ha[rua];
                        c ^= hc[rua];
                    }
                }
                // 2. 向前消元：
                // 用当前行去消去前面行中该位为 1 的部分
                for (int rua = 0; rua < bit; rua++) {
                    if (ha[rua].test(bit)) {
                        ha[rua] ^= a;
                        hc[rua] ^= c;
                    }
                }
                // 插入基底
                ha[bit] = a;
                hc[bit] = c;
                return true; // 插入成功，方程线性无关
            }
            // 如果该位已经有主元了，就用它消去当前方程的这一位，继续处理低位
            a ^= ha[bit];
            c ^= hc[bit];
        }
    }
    return false; // 方程线性相关（所有位都被消成了0）
};


// 判断一个向量 a 是否能被当前线性基表示（无需求解，只做可表性判断）
auto canRepresent = [&](bitset<MAXLOG> a) {
    for (int bit = 0; bit < MAXLOG; bit++) {
        if (a.test(bit)) {
            if (!ha[bit].any()) return false; // 这一位没有主元，表示不了
            a ^= ha[bit];
        }
    }
     return true; // 可以消成 0，说明在空间内
};
```

- **目的**：维护一个对角化（或者接近对角化）的矩阵，使得我们能直接读出每个变量的值。
- **逻辑**：如果能插入，说明这个查询提供了新的信息；如果不能插入（返回 `false`），说明这个查询是多余的，可以通过已有的查询组合得到。





## CDQ分治

1.找到当前区间[l,r]中点mid
2.递归处理左子区间[l,mid]
3.递归处理右子区间[mid+1,r]
4.处理左(右)区间对右(左)区间的影响,对右(左)区间/答案进行修改

### 三维偏序

先按第一维排序，就变成了二维偏序问题,就是有多少(i,j),l<=i<=mid&&mid+1<=j<=r
假设已经求出[l,mid]和[mid+1,r],求[l,r]
我们对[l,mid],[mid+1,r]以b为第二关键字排序
考虑枚举j,对于每个bi<bj,用树状数组查询有多少个c小于cj

```c++
const int maxn = 2e5+10;
int tree[maxn],n,m,k,ans[maxn];
inline int lowbit(int x){
    return x&(-x);
}

inline void update(int x,int v){
    for(int i = x;i<=k;i+=lowbit(i)){
        tree[i]+=v;
    }
}

inline i64 query(int r){
    i64 res = 0;
    for(int i = r;i>0;i-=lowbit(i)) res+=tree[i];
    return res;
}

struct ty{
    int a,b,c,cnt,p;
}aa[maxn],f[maxn];
bool cmp1(ty x,ty y){
    if(x.a!=y.a) return x.a<y.a;
    if(x.b!=y.b) return x.b<y.b;
    return x.c<y.c;
}
bool cmp2(ty x,ty y){
    if(x.b!=y.b) return x.b<y.b;
    return x.c<y.c;
}

void cdq(int l,int r){
    if(l==r) return;
    int mid = (l+r)>>1;
    cdq(l,mid);
    cdq(mid+1,r);
    sort(f+l,f+mid+1,cmp2);
    sort(f+mid+1,f+r+1,cmp2);
    int now = l;
    for(int i = mid+1;i<=r;++i){
        while(f[now].b<=f[i].b&&now<=mid){
            update(f[now].c,f[now].cnt);
            now++;
        }
        f[i].p += query(f[i].c);
    }
    for(int i = l;i<now;++i) update(f[i].c,-f[i].cnt);//清空树状数组
    return;
}
signed main(){
    ios;cin>>n>>k;
    for(int i = 1;i<=n;++i) cin>>aa[i].a>>aa[i].b>>aa[i].c;
    sort(aa+1,aa+n+1,cmp1);
    int now = 0;
    for(int i = 1;i<=n;++i){
        now++;
        if(aa[i].a!=aa[i+1].a||aa[i].b!=aa[i+1].b||aa[i].c!=aa[i+1].c){
            m++;
            f[m].a=aa[i].a;
            f[m].b=aa[i].b;
            f[m].c=aa[i].c;
            f[m].cnt = now;//去重，统计出现次数
            now = 0;
        }
    }
    cdq(1,m);
    for(int i = 1;i<=m;++i) ans[f[i].p+f[i].cnt]+=f[i].cnt;
    for(int i = 1;i<=n;++i) cout<<ans[i]<<'\n';
    return 0;
}
```



## 线性基

### greedy作法

```c++
i64 p[66];
void insert(i64 x){
    for(int i = 63;i>=0;--i){
        if(!(x>>i)) continue;
        if(p[i]) x^=p[i];//x第i位为1,p[i]的这一位已存在,从高到低扫描,p[i]前面的位都是0
        else{
            p[i]=x;break;//不存在直接赋值即可
        }
    }
}
```

贪心法构造的线性基需要从大到小枚举，取xor的max
查询异或第k大，需要重新构造线性基，s.t.每一位都是唯一的,
如果p[i]<p[j],p[j]的第i位是1,那么让p[j]^=p[i]
查询异或最大值，为什么可以，从高位往低位扫，扫到第i位，后面就没有机会改变这一位的取值



## 多项式全家桶



### 快速傅里叶变换(FFT)

**多项式一定是 $2^n$ 长度**

任意 $d$ 阶多项式可以由 $d+1$ 阶多项式确定

复平面单位根 $\omega^{j+\frac{n}{2}} = -\omega^j$

将多项式 $a$ ,  $b$ 的系数表示法表示成点值表示法，$a$ ,$b$ 点值相乘获得 $c$ 的点值表示法,对 $c$ 做逆变换求出系数表示法

对于 $a$, $b$ 两个多项式算出 $2^n$ 个点 $y$ 值(左半部分和右半部分对称)
二者 $y$ 值相乘 $(x_i,y_i)$ 就是 $c(x)=a(x)\cdot b(x)$ 的点值表示法
用傅里叶逆变换求出多项式系数
$y_e = z_e+w*z_o$,
$y_o = z_e-w*z_o$

记得逆变换要乘上 $\frac{1}{n}$ 

STL的complex可能有精度问题，可以手写复数类,运用蝶形变换的时间复杂度 $O(\frac{n}{2}logn)$

```cpp
#include<bits/stdc++.h>
using namespace std;
using i64 = long long;
using Complex = complex<double>;
constexpr double PI = acos(-1LL);

void fft(vector<Complex>&a,i64 type,vector<i64>&r){//type=1,变换成点值表示法,type -1逆变换
    i64 s = a.size();
    for(int i= 0;i<s;++i){//保证只交换一次,进行一次蝶形变换
        if(i<r[i]) swap(a[i],a[r[i]]);
    }
    for(int m = 1;m<s;m<<=1){ //每个子问题规模
        Complex W(cos(2*PI/(2*m)*type),sin(2*PI/(2*m)*type));//旋转因子,2*PI/(2*m)是步长
        for(int i = 0;i<s;i+=(m<<1)){//将数组分成若干段，每段长2*m,每段内执行蝶形运算
            Complex w(1,0);
            for(int j = 0;j<m;++j,w*=W){//位序变换之后ze和ye都在下标k位置,zo,y0都在下标k+n/2的位置
                Complex x = a[i+j],y = w*a[i+m+j];
                a[i+j] = x+y;
                a[i+m+j]=x-y;
            }    
        }
    }
}
i64 n,m,cnt;
signed main(){
    ios::sync_with_stdio(0);cin.tie(0);
    cin>>n>>m;
    cnt = n+m+1;
    i64 s=1,l = 0;
    while(s<cnt){
        s<<=1LL;
        ++l;
    } 
    //s必须是2^n
    vector<i64> r(s,0);
    for(int i = 1;i<s;++i){
        r[i] = (r[i>>1]>>1)|((i&1)<<(l-1));
    }
    vector<Complex> f(s,0),g(s,0),res(s,0);
    for(int i = 0;i<=n;++i) cin>>f[i];
    for(int i = 0;i<=m;++i) cin>>g[i];
    fft(f,1,r);
    fft(g,1,r);
    for(int i = 0;i<s;++i) res[i] = f[i]*g[i];
    fft(res,-1,r);
    for(int i = 0;i<s;++i){
        res[i] = res[i]/Complex(s,0);//乘上1/n
    }
    for(int i = 0;i<=n+m;++i){
        cout<<(i64)(res[i].real()+0.5)<<" ";
    }
  return 0;
}
```





### NTT快速数论变换

欧拉定理

- 若 $a,m$ 互质，则 $a^{\phi(m)}\equiv 1(mod\ m)$ ，$\phi(m)$ 是欧拉函数

阶: 若 $g,p$ 互质，使得 $g^n \equiv 1(mode\ p)$ 的最小正整数 $n$ ,称为 $g$ 模 $p$ 的阶，记作 $\delta_p(g)$ 

原根: $\delta_p(g)=\phi(p)$ ,称 $g$ 模 $p$ 的一个原根

- $\delta_7(3)=\phi(7)$ ,3是模7的一个原根，$\delta_7(2)=3 \neq \phi(7)$,2不是模7的一个原根
- 性质
  - 若 $g$是模 $p$ 的一个原根 ， 则 $g^0,g^1...,g^{\delta-1}$ 模 $p$ 意义下两两不同，之后进入周期



**常用模数:**

| 原根 |   模数p    | 分解 |  最大长度    |
| :--: | :--------: | :--: | :----: |
|  3   | 469762049  |  $7\times 2^{26}+1$  |   $2^{26}$   |
|  3   | 998244353  |  $119\times 2^{23}+1$  |   $2^{23}$   |
|  3   | 2281701377 |  $17\times 2^{27}+1$  |   $2^{27}$   |

原根与单位根性质类似，故只要把FFT中的 $\omega$ 换成原根 $g$ 即可

使用与FFT类似

```cpp
constexpr int P = 469762049,G=3;
i64 qp(i64 a,i64 b){...}//快速幂

void ntt(vector<int> &a,int type,vector<int> &r){
    int s = a.size();
    for(int i = 0;i<s;++i){
        if(i<r[i]) swap(a[i],a[r[i]]);
    }
    for(int m = 1;m<s;m<<=1){
        i64 Wn = qp(G,(P-1)/(m<<1));
        if(type==-1) Wn=qp(Wn,P-2);
        for(int i = 0;i<s;i+=(m<<1)){
            i64 w=1;
            for(int j = 0;j<m;++j){
                int x = a[i+j],y = 1ll*w*a[i+m+j]%P;
                a[i+j] = x + y >= P ? x + y - P : x + y;
                a[i+m+j] = x - y <0 ? x - y + P : x - y;
                (w*=Wn)%=P;
            }
        }
    }

    if(type==-1){
        i64 inv_s = qp(s,P-2);
        for(int &x:a) x = (i64) x*inv_s%P;
    }//统一处理,不用在外面额外乘s的逆元
}

int s,l;...//s是第一个大于等于多项式乘积的2的幂次,l是最高位
vector<int> r(s,0);
for(int i = 1;i<s;++i) r[i] = (r[i>>1]>>1|((i&1)<<(l-1)));
...//读入多项式 f,g
ntt(f,1,r);
ntt(g,1,r);
for(int i = 0;i<s;++i) res[i] = 1ll*f[i]*g[i]%P;
ntt(res,-1,r);
```



### 多项式求逆

对于给定多项式 $f(x) = a_0+a_1x+a_2x+...$, 如果想找到 $g(x)$ , $s.t. f(x)g(x) \equiv 1$ ,先求出常数项 $a_0 $ 的逆元 $g_0$ 

之后利用经典 Newton 迭代公式
$$
g_1=g_0(2-fg_0)\quad (mod\ x^{2m})
$$

```cpp
vector<int> build_rev(int n) {
    int l = __builtin_ctz(n);
    vector<int> r(n);
    for (int i = 1; i < n; ++i) {
        r[i] = (r[i >> 1] >> 1) | ((i & 1) << (l - 1));
    }
    return r;
}

vector<int> poly_inv(const vector<int> &f, int N) {//N指的是幂次，不是长度
    if (N == 0) return {};
    vector<int> g(1);
    g[0] = qp(f[0], P - 2);

    int m = 1;
    while (m < N) {
        int new_m = m << 1;
        int sz = 1;
        while (sz <= new_m) sz <<= 1;
        vector<int> r = build_rev(sz);
        vector<int> A(sz), B(sz);
        for (int i = 0; i < min(new_m, (int)f.size()); ++i) A[i] = f[i];
        for (int i = 0; i < m; ++i) B[i] = g[i];
        ntt(A, 1, r);
        ntt(B, 1, r);
        for (int i = 0; i < sz; ++i) {
            i64 t = static_cast<i64>A[i] * B[i] % P;
            B[i] = (2LL * B[i] % P - t * B[i] % P + P) % P;// 公式: B_new = B * (2 - A * B) = 2*B - A*B^2
        }
        ntt(B, -1, r);
        g.resize(new_m);
        for (int i = 0; i < new_m; ++i) {
            g[i] = B[i];
        }
        m = new_m;
    }
    g.resize(N);
    return g;
}
```





### 对数函数与指数函数

设 $A(x)$ 是一个多项式， $\frac{d}{dx}ln(A(x))=\frac{A'(x)}{A(x)}$

```cpp
// 辅助函数
inline int sub(int a, int b) { return (a - b + P) % P; }
inline int pls(int a, int b) { return (a + b) % P; }
vector<int> inv;// 全局逆元数组（需要预计算）

inline void derivative(const vector<int>& h, vector<int>& f) {
    int n = h.size();//需要保证f.size()>=n
    for (int i = 1; i < n; ++i) f[i-1] = (i64)h[i] * i % P;
    if(n>=1) f[n-1] = 0;
    for (int i = n; i < (int)f.size(); ++i) f[i] = 0;
}

inline void integrate(const vector<int>& h, vector<int>& f) {// 积分计算
    int n = h.size();
    for (int i = n - 1; i > 0; --i) {//需要保证f.size()>=n
        f[i] = static_cast<i64>(h[i - 1]) * inv[i] % P;
    }
    if (n > 0) f[0] = 0;
    for(int i = n;i<f.size();++i) f[i]=0;
} 


vector<int> poly_inv(const vector<int>& f, int N) {// 多项式求逆
....同上
}


void polyln(const vector<int>& h, int n, vector<int>& f) { // 多项式对数函数
    assert(h[0] == 1 && "h[0] must be 1");
    int t = 1;
    while (t < n * 2) t <<= 1;
    
    vector<int> ln_t(t, 0);
    derivative(h, ln_t);
    
    f = poly_inv(h, n);
    f.resize(t, 0);
    
    vector<int> r = build_rev(t);
    ntt(ln_t, 1, r);
    ntt(f, 1, r);
    for (int i = 0; i < t; ++i) {
        ln_t[i] = static_cast<i64>(ln_t[i]) * f[i] % P;
    }
    ntt(ln_t, -1, r);
    
    integrate(ln_t, f);
    f.resize(n);
}

// 多项式指数函数
void polyexp(const vector<int>& h, int n, vector<int>& f) {//原数组，需要的长度，写入的数组
    assert(h[0] == 0 && "h[0] must be 0");
    f.assign(1, 1);
    
    for (int t = 2; t <= n; t <<= 1) {
        int t2 = t << 1;
        
        // 计算ln(f)
        vector<int> exp_t;
        polyln(f, t, exp_t);
        exp_t.resize(t2, 0);
        
        // 构造g = (h - ln(f) + 1)
        exp_t[0] = sub(pls(h[0], 1), exp_t[0]);
        for (int i = 1; i < t; ++i) {
            exp_t[i] = sub(h[i], exp_t[i]);
        }
        fill(exp_t.begin() + t, exp_t.begin() + t2, 0);
        
        // 多项式乘法
        f.resize(t2, 0);
        vector<int> r = build_rev(t2);
        ntt(f, 1, r);
        ntt(exp_t, 1, r);
        for (int i = 0; i < t2; ++i) {
            f[i] = static_cast<i64>(f[i]) * exp_t[i] % P;
        }
        ntt(f, -1, r);
        
        // 清空高位
        f.resize(t);
    }
    f.resize(n);
}

// 预计算逆元数组
void init_inv(int maxn) {
    inv.resize(maxn + 1);
    inv[1] = 1;
    for (int i = 2; i <= maxn; ++i) {
        inv[i] = static_cast<i64>(P - P / i) * inv[P % i] % P;
    }
}
```





### 多项式快速幂

$B=A^k$ 退出 $log_AB=\frac{lnB}{lnA}=k$ ,所以 $B=e^{klnA}$

```cpp
vector<int> ln_f;
polyln(f,(1<<cnt),ln_f);
for(int i = 0;i<m;++i){
    ln_f[i] = static_cast<i64>(ln_f[i]) * k % P;
}
polyexp(ln_f,(1<<cnt),f);
```



## 拉格朗日插值

**目标:** 通过 $n$ 个已知点构造多项式函数 $f(x)$ 经过这个 $n$ 个点

$Lagrange$ 插值形式: $f(x)=\sum_{i=1}^n \prod_{\substack{ \\j\neq i}} \frac{x-x_j}{x_i-x_j}$

时间复杂度 朴素 $O(n^2)$ , 多项式快速插值 $O(nlog^2n)$

- 朴素实现

  - ```cpp
    i64 lagrange(vector<i64>& x, vector<i64>& y, i64 k) {//x:横坐标,y:纵坐标,k:多项式在x=k的函数值
        int n = x.size();
        i64 ans = 0;
        for (int i = 0; i < n; ++i) {
            i64 num = 1, den = 1;
            for (int j = 0; j < n; ++j) {
                if (i == j) continue;
                num = num * (k - x[j] + MOD) % MOD;
                den = den * (x[i] - x[j] + MOD) % MOD;
            }
            ans = (ans + y[i] * num % MOD * qpow(den, MOD - 2)) % MOD;
        }
        return ans;
    }
    ```

- 基于 $FFT/NTT$  的优化实现

  - ```cpp
    /******** 前提：你已提供以下函数/常量 ********
    constexpr int P = 469762049, G = 3;
    i64 qp(i64 a, i64 b);
    void ntt(vector<int>& a, int type, vector<int>& r);
    vector<int> build_rev(int n);      
    这份插值模板只会用到 qp/ntt/build_rev
    **************************************************/
    
    inline int addm(int a,int b){ int s=a+b; return s>=P? s-P:s; }
    inline int subm(int a,int b){ int s=a-b; return s<0? s+P:s; }
    
    static inline void trim(vector<int>& a){
        while(!a.empty() && a.back()==0) a.pop_back();
    }
    
    /*** 轻量多项式乘法：仅一次 NTT 往返，常数小 ***/
    static inline vector<int> multiply(vector<int> a, vector<int> b){
        if(a.empty() || b.empty()) return {};
        int need = (int)a.size() + (int)b.size() - 1;
        int n = 1; while(n < need) n <<= 1;
        a.resize(n, 0); b.resize(n, 0);
        auto r = build_rev(n);
        ntt(a, 1, r);
        ntt(b, 1, r);
        for(int i=0;i<n;++i) a[i] = (i64)a[i]*b[i]%P;
        ntt(a, -1, r);
        a.resize(need);
        trim(a);
        return a;
    }
    
    /*** 乘积树：poly[idx] = ∏_{t in segment} (x - xs[t]) ***/
    struct ProdTree {
        int n;
        vector<int> xs;
        vector<vector<int>> poly;  // 4n 个结点，存子段乘积多项式
    
        explicit ProdTree(const vector<int>& _xs): n((int)_xs.size()), xs(_xs){
            poly.resize(4*n);
            build(1,0,n-1);
        }
        void build(int idx,int l,int r){
            if(l==r){
                // (x - x_l) = (-x_l) + 1*x
                poly[idx] = { subm(0, xs[l]), 1 };
                return;
            }
            int mid=(l+r)>>1;
            build(idx<<1, l, mid);
            build(idx<<1|1, mid+1, r);
            poly[idx] = multiply(poly[idx<<1], poly[idx<<1|1]);
        }
    };
    
    /*** 多项式 A 对多项式 B 取模（简化版）：A mod B
     *  为了把常数降到更低，我们针对插值的规模，做一点小优化：
     *  - 小规模（deg(A) < ~64 或 deg(B) < ~64）直接“朴素降阶”(Horner样式)；
     *  - 否则用一次“反转+求逆”的快速法（用你给的 poly_inv）。
     *  这样在插值树中高层多项式度数较大时走快路，低层度数小时时走朴素，常数会显著下降。
     */
    static inline vector<int> poly_mod(vector<int> A, const vector<int>& B){
        trim(A); vector<int> Bb = B; trim(Bb);
        if(Bb.empty()) return {};
        int n = (int)A.size()-1, m = (int)Bb.size()-1;
        if(n < m) return A;
    
        // 阈值可以按机器微调（32/48/64），一般 48~64 比较稳
        const int NAIVE_T = 48;
        if(n < NAIVE_T || m < NAIVE_T){
            // 朴素“高位消元”：R = A
            vector<int> R = A;
            i64 inv_lead = qp(Bb.back(), P-2);
            for(int i=n;i>=m;--i){
                if(R[i]==0) continue;
                i64 coef = (i64)R[i]*inv_lead % P;
                // R[i-m...i] -= coef * B[0...m]
                for(int j=0;j<=m;++j){
                    R[i-j] = subm(R[i-j], (int)(coef * Bb[m-j] % P));
                }
            }
            R.resize(m);
            trim(R);
            return R;
        }
    
        // 快速法：Q = rev(A)*inv(rev(B)) 取前 n-m+1 项，R = A - Q*B
        int t = n - m + 1;
        auto rev_k = [](const vector<int>& a, int len){
            vector<int> r(len, 0);
            for(int i=0;i<(int)a.size() && i<len;++i) r[len-1-i] = a[i];
            return r;
        };
        vector<int> Ar = rev_k(A, n+1);
        vector<int> Br = rev_k(Bb, m+1);
        vector<int> invBr = poly_inv(Br, t);    // 用你给的 poly_inv
        vector<int> Qr = multiply(Ar, invBr);
        if((int)Qr.size() > t) Qr.resize(t);
        vector<int> Q = rev_k(Qr, t); trim(Q);
    
        // R = A - Q*B
        vector<int> QB = multiply(Q, Bb);
        // 只保留 < m 的部分
        vector<int> R(max((int)A.size(), (int)QB.size()), 0);
        for(size_t i=0;i<A.size();++i) R[i] = addm(R[i], A[i]);
        for(size_t i=0;i<QB.size();++i) R[i] = subm(R[i], QB[i]);
        if((int)R.size() > m) R.resize(m);
        trim(R);
        return R;
    }
    
    /*** 计算 denom[i] = ∏_{j!=i} (xs[i] - xs[j])
     *  不用求导，不做通用多点求值，常数小：
     *  思路：在树上“把兄弟多项式在本子段的点上取值并乘到 prod 上”。
     *  实现：递归传下“当前要在这段点上评价”的多项式 p（是兄弟段的乘积多项式，随着递归不断对当前段的乘积取模降阶），
     *  到叶子时 p(x_i) 就是一段的贡献；沿路径乘起来正好是 ∏_{j!=i}(x_i-x_j)。
     */
    static inline void fill_denoms(ProdTree& T, vector<int>& denom){
        int n = T.n;
        denom.assign(n, 1);
    
        // 递归：把多项式 p 在区间 [l,r] 的各 x 上求值（通过不断对 poly[idx] 取模降阶）
        function<void(int,int,int,const vector<int>&)> push =
        [&](int idx,int l,int r,const vector<int>& p){
            if(p.empty()) return;
            if(l==r){
                // 直接 Horner
                i64 x = T.xs[l], s = 0;
                for(int i=(int)p.size()-1;i>=0;--i){
                    s = (s*x + p[i]) % P;
                }
                denom[l] = (i64)denom[l] * s % P;
                return;
            }
            int mid=(l+r)>>1;
            // 分别把 p 在左/右子段的点上评价：先对左右子段乘积取模降阶，再下推
            vector<int> pL = poly_mod(p, T.poly[idx<<1]);     // 在右子段用到的 p 的形态
            vector<int> pR = poly_mod(p, T.poly[idx<<1|1]);   // 在左子段用到的 p 的形态
    
            // 注意：这里是“兄弟评价”的方向：
            // - 想给左子段的点乘上右子段的多项式 → 传入 p = poly[right]，对左子段的乘积取模
            // - 想给右子段的点乘上左子段的多项式 → 传入 p = poly[left]，对右子段的乘积取模
            // 因此 push 时需要正确形参。
            push(idx<<1,     l,     mid, pR); // 给左子段的点：乘上右子段多项式在这些点的值
            push(idx<<1|1, mid+1,     r, pL); // 给右子段的点：乘上左子段多项式在这些点的值
        };
    
        // 从根出发：根的左右子树互为兄弟
        // 给左边点乘右边多项式值
        if(n>1) push(1, 0, n-1, T.poly[1]); // 先整体推进一次，但需要拆分为兄弟传递
        // 上面这句会在根叶同时“自己给自己取模”，常数略大；更紧凑的做法如下两句替代：
        denom.assign(n, 1);
        if(n==1){ denom[0]=1; return; }
        // 左子段乘右子树
        push(1<<1, 0, (n-1)>>1, T.poly[(1<<1)|1]);      // idx=2, p=poly[3]
        // 右子段乘左子树
        push((1<<1)|1, ((n-1)>>1)+1, n-1, T.poly[1<<1]); // idx=3, p=poly[2]
    
        // 上面两次 push 只做了根层兄弟一次，下层兄弟乘法怎么办？
        // ——push 内部在每层都会把“兄弟多项式”沿树继续对“当前子段乘积”取模并递归下去，
        // 所以**整棵树的兄弟贡献**会在一次 push 链上完成（到叶子为止）。
    }
    
    /*** O(n log^2 n) 拉格朗日插值：输入 (xs, ys)，返回 F(x)（次数 < n）
     *  核心：
     *   1) 构乘积树得到 M(x)=∏(x-x_i)
     *   2) 用上面的 fill_denoms 得到 denom[i]=∏_{j≠i}(x_i-x_j)
     *   3) 权重 w_i = y_i / denom[i]
     *   4) 分治合成：F = Σ_i w_i * (M/(x-x_i))，
     *      在树上递归：叶子返回 {w_i} 常数；父亲：F = F_L * M_R + F_R * M_L
     */
    static inline vector<int> lagrange_interpolate(const vector<int>& xs, const vector<int>& ys){
        int n = (int)xs.size();
        vector<int> F;
        if(n==0) return F;
        if(n==1){ F = { ys[0]%P }; return F; }
    
        ProdTree T(xs);
        // 2) denom[i]
        vector<int> denom;
        fill_denoms(T, denom);
    
        // 3) 权重 w_i
        vector<int> w(n);
        for(int i=0;i<n;++i){
            int invd = qp(denom[i], P-2);
            w[i] = (i64)ys[i] * invd % P;
        }
    
        // 4) 分治合成多项式
        function<vector<int>(int,int,int)> solve = [&](int idx,int l,int r)->vector<int>{
            if(l==r) return vector<int>{ w[l] }; // 常数多项式
            int mid=(l+r)>>1;
            auto FL = solve(idx<<1, l, mid);
            auto FR = solve(idx<<1|1, mid+1, r);
            auto left  = multiply(FL, T.poly[idx<<1|1]); // * M_R
            auto right = multiply(FR, T.poly[idx<<1]);   // * M_L
            // 相加
            if(left.size() < right.size()) left.resize(right.size(), 0);
            for(size_t i=0;i<right.size();++i) left[i] = addm(left[i], right[i]);
            trim(left);
            return left;
        };
    
        F = solve(1, 0, n-1);
        if((int)F.size() > n) F.resize(n); // 理论上 < n
        trim(F);
        return F;
    }
    
    /*** 单点求值：给定 F(x) 与点 k，Horner **/
    static inline int eval_at(const vector<int>& F, int k){
        i64 s=0, x=k;
        for(int i=(int)F.size()-1;i>=0;--i) s=(s*x + F[i])%P;
        return (int)s;
    }
    ```

    - 用法:

      **构造多项式**

    - ```cpp
      vector<int> xs(n), ys(n);
      // 读入 (x_i, y_i) 并保证 x_i 互不相同 (mod P)
      auto F = lagrange_interpolate(xs, ys); // F[0] 常数项
      ```

      在一个点 $k$ 上取值

      - ```cpp
        int val = eval_at(F, k);
        ```

      - 如果只要单点 $f(k)$ 小数据朴素做法更快

      - 使用方法:

        - 乘法前：`need = A.size()+B.size()-1`；`n` 向上凑到 ($2^k￥)；`rev = build_rev(n)`；两者一致。
        - `poly_mod`：`trim(B)` 且 `B.back()!=0`；小规模走朴素，大规模走快速；结果 `resize(m)` 并 `trim`。
        - 插值：`x_i` 互异、`denom[i] != 0`；`w_i = y_i * inv(denom[i])`。
        - 合成：`F = FL*M_R + FR*M_L`；最后 `resize(n)`、`trim(F)`。
        - `polyln/polyexp` 用前提：`ln` 的输入常数项 1；`exp` 的输入常数项 0；`init_inv()` 已做且够大。







# 动态规划(DP)



## 互异拆分数

把整数 $i$ 划分为 $j$ 个严格递增的正整数的方案数,尝尝对应一个长度为 $n$ 的数组划分
$$
dp[0][0] = 1\\
dp[i][j] = dp[i-1][j-1]+dp[i-j][j]
$$
**边界注意:** 若 $i<j$ 则 $dp[i][j]=0$ 。若最小可能和 $1+2+\cdots+j=\frac{(1+j)\cdot j}{2}>i$ 也剪枝为 $0$,所以复杂度理论上是$O(n\sqrt n)$ 





## LIS

### O($n^{2}$)dp

```c++
for(int i = 1;i<=n;++i){
	for(int j =1;j<i;++j){
		if(a[j]<a[i]){
			//f[i] = max(f[i],f[j+1]);
			if(f[j]+1>=f[i]){
				f[i] = f[j]+1;
				list[i] = j;//list[i]用于输出路径
			}
		}
	}
}
```

### O($nlogn$) greedy

```c++
int len=0;
for(int i = 1;i<=cnt;++i){
    auto pos = lower_bound(f,f+len,dfn[i])-f;
    if(pos==len) f[len++] = dfn[i];
    else f[pos] =dfn[i];
}
```

**只能返回最长上升子序列的长度**



## LCS(最长公共子序列)

$$
C[i,j] = \begin{cases}
0 & \text{if } i=0 \text{ or } j=0 \\
C[i-1,j-1] + 1 & \text{if } i > 0 \text{ and } j > 0 \text{ and } x_i = y_j \\
\max(C[i-1,j], C[i,j-1]) & \text{if } i > 0 \text{ and } j > 0 \text{ and } x_i 
\neq  y_j
\end{cases}
$$



## 背包

### 01背包

```c++
for(int i = 1;i<=n;i++){
	for(int j = 1;j<=m ;j++){
		if(j<w[i]) dp[i][j] = dp[i-1][j];
		else{
			dp[i][j] = max(dp[i-1][j-w[i]]+v[i],dp[i-1][j]);
		}
		printf("%d ",dp[i][j]);
	}
	printf("\n");
}

```



### 完全背包

```c++
for(int i = 1;i<=n;i++){
	for(int v = w[i];v<=m;v++){
		if(f[v-w[i]]+c[i]>f[v]){
			f[v] = f[v-w[i]]+c[i];
		}
	}
}
```



### 多重背包

#### 二进制优化

```c++
int v[10001],w[10001];
int f[6001];
int n,m,pos=0;
int main(){
	scanf("%d%d",&m,&n);
	for(int i = 1;i<=n;i++){
		int v1,w1,s,k = 1;
		scanf("%d%d%d",&w1,&v1,&s);
		while(s>=k){
			v[++pos] = v1*k;//等价pos++;v[pos] =v1*k
			w[pos] = w1*k;
			s-=k;
			k*=2;
		}
		if(s){//如果s还有值，说明s不是2的次方 
			v[++pos] = v1*s;
			w[pos] = w1*s;
		} 
	}
	for(int i = 1;i<=pos;i++){
		for(int j = m;j>=w[i];j--){
			f[j] = max(f[j],f[j-w[i]]+v[i]);
		}
	}
	printf("%d",f[m]);
	return 0;
}
```



#### 单调队列优化

```c++
const int N = 1e5+10;
int v,w,s;
int q[N];
int f[N],g[N];
int n,m;

int main(){
	scanf("%d%d",&n,&m);
	for(int i = 1;i<=n;++i){
		memcpy(g,f,sizeof(f));
		cin>>v>>w>>s;//体积，价值，数量 
		for(int j = 0;j<v;++j){//拆分成v个类 
			int h = 0,t = -1;
			for(int k = j;k<=m;k+=v){//对每类东西使用单调队列 
				if(h<=t && q[h]<k-s*v) h++;//q[h]不在窗口范围内，队头出队 
				//用队头更新最大值 
				if(h<=t) f[k] = max(g[k],g[q[h]]+(k-q[h])/v*w);
				//当前值比队尾更有价值，队尾出队
				while(h<=t &&g[k]>=g[q[t]]+(k-q[t])/v*w) t--;
				//下标入队
				q[++t] = k; 
			}
		}
	}
	cout<<f[m];
	return 0;
}
```



### 二维费用

```c++
int v,u,k;
int a[1001],b[1001],c[1001];
int f[101][101];
int main(){
	memset(f,10000,sizeof(f)); 
	f[0][0] = 0;
	scanf("%d%d%d",&v,&u,&k);
	for(int i = 1;i<=k;i++){
		scanf("%d%d%d",a+i,b+i,c+i);
	}
	for(int i = 1;i<=k;i++){
		for(int j = v;j>=0;j--){
			for(int l = u;l>=0;l--){
				int t1 = j+a[i],t2 = l+b[i];
				if(t1>v) t1 = v;//超过需求量，用需求量替换 
				if(t2>u) t2 = u;//不影响最优解 
				if(f[t1][t2]>f[j][l]+c[i]){
					f[t1][t2] = f[j][l]+c[i];				
				}
			}
		}
	}
	printf("%d",f[v][u]);
	return 0;
}
```



## 区间dp



### 合并石子类

f[l,r]表示把石子从l到r合并成一堆的最小代价
先把[l,r]分为[l,k],[k+1,r]两部分，再合并在一起
优化用前缀和求区间和
f[l,r] = min(f[l,r],f[l,k]+f[k+1,r]+s[r]-s[l]);
初值f[i,i] = 0,其余为正无穷

```c++
const int N = 310;
int n;//石子堆数 
int a[N];//记录每堆石子的质量 
int s[N];//记录前缀和 
int f[N][N]; //见上方 
 
int main(){
	//预处理
	memset(f,0x3f,sizeof(f)); 
	scanf("%d",&n);
	for(int i = 1;i<=n;i++){
		scanf("%d",a+i);
		s[i] = s[i-1]+a[i];
		f[i][i] = 0;
	}
	//状态计算
	for(int len = 2;len<=n;len++){//枚举区间长度 
		for(int l = 1;l+len-1<=n;l++){//枚举区间起点 
			int r = l+len-1;//区间终点 
			for(int k = 1;k<r;k++){//枚举分割点 
				f[l][r] = min(f[l][r],f[l][k]+f[k+1][r]+s[r]-s[l-1]);
			} 
		} 
	}
	printf("%d",f[1][n]);

	return 0;
}
```



### 编辑距离类

```c++
char A[MAX],B[MAX]; 
int dp[MAX][MAX];//dp[i][j] means长度为i的a字符串变为长度为j的b字符串的编辑距离 
int main(){
	scanf("%s%s",A,B);
	int m = strlen(A),n = strlen(B);
	for(int i = 0;i<=m;i++){
		dp[i][0] = i;
	}
	for(int i = 0;i<=n;i++){
		dp[0][i] = i;
	}
	for(int i = 1;i<=m;++i){
		for(int j = 1;j<=n;++j){
			if(A[i-1]==B[j-1]) dp[i][j]= dp[i-1][j-1];
			else{
				dp[i][j] = min(min(dp[i][j-1],dp[i-1][j]),dp[i-1][j-1])+1;
			} 
		}
	}
	printf("%d",dp[m][n]);
	return 0;
}
```





## 数位dp 

复杂度大概位数*10

### 模板:出现x的数字个数

```c++
#include<bits/stdc++.h>
using namespace std;
using i64 = long long;
using i128 = __int128;

constexpr int maxn = 2e5+10;
int len,a[maxn],dp[20][2][2];

long long dfs(int pos,int limit,int flag){//pos 数位 ，limit 是否有限制,flag 数字是否出现过
    if (pos==len) return flag;
    if (dp[pos][limit][flag]) return dp[pos][limit][flag];
    int rg=limit?a[pos]:9;
    long long ans=0;
    for (int i=0;i<=rg;i++){
        if(i==5) ans+=dfs(pos+1,limit&&i==rg,1);
        else ans+=dfs(pos+1,limit&&i==rg,flag);
    }
    return dp[pos][limit][flag]=ans;
}
signed main(){
    ios::sync_with_stdio(0);cin.tie(0);
    int l,r;
    cin>>r;
    while(r){
        a[len++]=r%10;
        r/=10;
    }
    reverse(a,a+len);
    cout<<dfs(0,1,0)<<"\n";
    return 0;
}
```



## 优化

### 斜率优化

对DP方程进行移项，变成形如 $y = k\cdot x + b$ 的形式

遵循的原则:把含有$function(i)\cdot function(j)$ 的表达式看成斜率 $k_0$ 乘上未知数 $x$ , 含有 $dp[i]$ 的项必须要在 $b$ 的表达式中，含有 $function(j)$ 的项必须在 $y$ 的表达式中

这样转换之后，数形结合一下，相当于是要求**截距的最小值**，那么只要单调队列维护凸包点集即可(假设按顺序有 $j_0,j_1,j_2$ 依次三个点，可以考虑 $(j_1,j_0)$ , $(j_2,j_1)$ 两条直线的斜率去维护凸集)，二分最优决策点，如果有决策单调性可以进一步优化为 $O(n)$



**使用斜率优化的情况?**

DP方程可以写成 $\frac{Y(i)-Y(j)}{(X(i)-X(j))} \le k_0$ 的形式

如果dp方程求 $min$ 维护下凸，如果 dp方程求 $max$ 维护上凸

当 $X(j)$ 非严格递增时，可能会出现平行 $y$ 轴的直线，此时返回 $inf$ 方便查错、



#### 维护下凸和

斜率优化也有一些其他应用，其中可以维护下凸和

考虑 $m$ 条一次函数

```c++
struct point{
    int x,y;// 分子分母
    friend bool operator<(const point& A,const point &B){
        return (i128) A.x*B.y<(i128) B.x*A.y;
    }
}; 
sort(line.begin(),line.end(),[&](const auto &A,const auto &B){
	return A.b==B.b?A.k<B.k:A.b<B.b;
});//先让直线按(截距,斜率)从小到大排序
vector<pair<point,Line>> st;//{和前一条直线的交点(手写分数)，直线}
st.push_back(pair<point,Line>{{0,1},line[0]});//保证不会小于0
for(int i = 1;i<line.size();++i){
    auto [k,b] = line[i];
    if(k>=st.back().second.k||b==st.back().second.b) continue;
    int lst = st.size()-1;
    point x = {0,1};
    while(st.size()>1&&(x=calc(st[lst-1].second,line[i]))<st[lst].first){
        st.pop_back();
        lst = st.size()-1;
    }
    st.push_back({calc(st.back().second,line[i]),line[i]});
}
```





# 计算几何

用 $asin()$ , $acos()$ 函数 对小于 $0$ 的数要对 $-1$ 取max ,大于 $0$ 的数要对 $1$ 取 $min$

`double atan(double x);` tan(x) 的反函数，返回弧度

`long double atan2l(long double y, long double x);` 根据象限范围 $(-\pi,\pi]$ ,$y$ 是纵坐标 , $x$ 是横坐标,

普通版本 `double atan(double y,double x)`

菱形求交公式 ($u = x+y$ , $v = x-y$ 推导, $l$ 是菱形延伸的最长距离):

- $i+j-l\le x+y\le i+j+l$

- $i-j-l\le x-y\le i-j+l$

- 在$(u,v)$ 坐标系里，这正好是一个轴平行矩形: $u = x+y\in[i+j-l,i+j+l],\quad v=x-y\in[i-j-l,i-j+l]$

- 因此判断多个菱形交集只需要:

  - ```cpp
    maxSum  = max(maxSum,  (i+j) - x);
    minSum  = min(minSum,  (i+j) + x);
    maxDiff = max(maxDiff, (i-j) - x);
    minDiff = min(minDiff, (i-j) + x);
    return maxSum <= minSum && maxDiff <= minDiff;
    ```



各类距离:

- 曼哈顿距离 : $d(A,B)=|x_1-x_2|+|y_1-y_2|$
  - 简单理解:只能沿着 $x$ 轴和 $y$ 轴移动

- 切比雪夫距离: $d(A,B) = max(|x_1-x_2|,|y_1-y_2|)$

- 曼哈顿距离和切比雪夫距离转化:

  - 将 $(x,y)\rightarrow (x+y,x-y)$ 变化后，原坐标的曼哈顿距离等于新坐标系的切比雪夫距离,相当于把菱形变成正方形
  - 将 $(x,y)\rightarrow (\frac{x+y}{2},\frac{x-y}{2})$ 变化后,原坐标系中的切比雪夫距离等于新坐标系的曼哈顿距离,相当于把正方形变成菱形

  

## 坐标轴变换

$$
\left(
\begin{array}{c}
x' \\
y'
\end{array}
\right) \quad=\quad

\left(
\begin{matrix}
\cos\theta & \sin\theta \\
-\sin\theta & \cos\theta \\
\end{matrix}
\right) \cdot

\left(
\begin{array}{c}
x \\
y
\end{array}
\right)
$$

$(x, y)$ 是原坐标轴坐标分量， $(x',y)'$  是新坐标轴坐标分量,将 $(x,y)$ **顺时针**旋转 $\theta$ 

逆变换为
$$
\left(
\begin{array}{c}
x \\
y
\end{array}
\right) \quad=\quad

\left(
\begin{matrix}
\cos\theta & -\sin\theta \\
\sin\theta & \cos\theta &\\
\end{matrix}
\right) \cdot

\left(
\begin{array}{c}
x' \\
y'
\end{array}
\right)
$$

在处理直线只有一条等情况下，可以将坐标轴旋转，让直线斜率为0，这样只需要处理x分量即可

只要求旋转不要求缩放的话，逆时针旋转 $45^{\circ}$ 度 : $(x,y)\rightarrow (x-y,x+y)$



## 需要的声明

```cpp
inline int dcmp(double x){// 判断正、负还是0
    if (fabs(x) < eps) return 0;
    return x > 0 ? 1 : -1;
}
inline double cross(const point &a, const point &b) {// 叉积
    return a.x * b.y - a.y * b.x;
}
```





## 点/向量(Point)

```cpp
constexpr double eps = 1e-8;
template<typename T> struct Point {
    T x, y;
    Point() : x(T(0)), y(T(0)) {}
    Point(T x, T y) : x(x), y(y) {}
    template<typename U>Point(const Point<U>& other) : x(T(other.x)), y(T(other.y)) {}// 从另一个点构造（类型转换）
    inline Point operator-(const Point& other) const {// 两点相减（返回向量差）
        return Point(x - other.x, y - other.y);
    }
    inline Point operator+(const Point& other) const {// 两点相加（返回向量和）
        return Point(x + other.x, y + other.y);
    }
    inline Point operator*(T scalar) const {// 标量乘法（点坐标缩放）
        return Point(x * scalar, y * scalar);
    }
    inline Point operator/(T scalar) const {// 标量除法（点坐标缩放）
        return Point(x / scalar, y / scalar);
    }
    inline T dot(const Point& other) const { // 点积（向量内积）
        return x * other.x + y * other.y;
    }
    inline T cross(const Point& other) const {// 叉积（向量叉积，返回z分量的值）
        return x * other.y - y * other.x;
    }
    inline double dis(const Point& other) const {// 计算到另一点的距离（返回double保证精度）
        T dx = x - other.x;
        T dy = y - other.y;
        return std::hypot(dx, dy);  // 使用hypot避免溢出
    }
    inline double len() const {// 向量长度（模）
        return std::hypot(x, y);
    }
    inline Point<double> normalized() const {// 单位化向量（返回double类型点）
        double l = len();
        if (l == 0) return Point<double>(0, 0);  // 避免除以零
        return Point<double>(x / l, y / l);
    }
};
using point = Point<double>;
```



## 极角排序

```cpp
void psort(vector<point> &ps, point c = {0, 0}) {
    // 判断向量 v = p - c 属于“上半平面”还是“下半平面”：
    //   如果 y > 0 或 (y == 0 且 x >= 0)，我们认为它在上半平面（返回 true），否则在下半平面（返回 false）。
    auto half = [&](const point &v) {
        return (v.y > +eps) || (fabs(v.y) <= eps && v.x >= -eps);
    };
    sort(ps.begin(), ps.end(), [&](const point &p1, const point &p2) {
        // 先平移到以 c 为原点
        point v1 = p1 - c;
        point v2 = p2 - c;
        bool h1 = half(v1), h2 = half(v2);
        if (h1 != h2) return h1 > h2;// 上半平面的点排在前面
        // 在同一个半平面内，再看叉积：
        // cross(v1, v2) >  0 → v2 在 v1 的逆时针方向上 → v1 角度更小 → 放在前
        // cross(v1, v2) <  0 → v2 在 v1 的顺时针方向上 → v2 角度更小 → 放在后
        double cr = v1.cross(v2);
        if (fabs(cr) > eps)  return cr > 0; 
        //共线:按距离平方从小到大
        double d1 = v1.x * v1.x + v1.y * v1.y;
        double d2 = v2.x * v2.x + v2.y * v2.y;
        return d1 < d2;
    });
}
```

如果全是整数点，不需要 eps ,叉积，距离只需要整数

```cpp'
auto half = [&](const point &v){
	return v.y > 0 || (v.y == 0 && v.x >= 0);
};
```







## 直线(line)

```cpp
struct Line {
    point p[2];
    double k, b;
    Line() {}
    Line(double x1, double y1, double x2, double y2) { p[0] = point(x1, y1); p[1] = point(x2, y2); }
    Line(const point &a, const point &b) { p[0] = a; p[1] = b; }
    // 直线长度
    double length() const {
        return sqrt((p[0].x - p[1].x)*(p[0].x - p[1].x) + (p[0].y - p[1].y)*(p[0].y - p[1].y));
    }
    // 获取 k、b 参数
    void get_para() {
        if (dcmp(p[0].x - p[1].x) == 0) {
            k = inf;
            b = inf;
        } else {
            k = (p[1].y - p[0].y) / (p[1].x - p[0].x);
            b = p[0].y - k * p[0].x;
        }
    }
    // 点到直线距离
    double dis_Point(const point &pt) const {
        if (k == inf) return fabs(pt.x - p[0].x);
        return fabs(k * pt.x - pt.y + b) / sqrt(1 + k * k);
    }
};

// 判断两直线是否相交，包含端点
bool intersection(const Line &l1, const Line &l2) {
    // 快速排斥
    if (max(l1.p[0].x, l1.p[1].x) < min(l2.p[0].x, l2.p[1].x) ||
        max(l2.p[0].x, l2.p[1].x) < min(l1.p[0].x, l1.p[1].x))
        return false;
    if (max(l1.p[0].y, l1.p[1].y) < min(l2.p[0].y, l2.p[1].y) ||
        max(l2.p[0].y, l2.p[1].y) < min(l1.p[0].y, l1.p[1].y))
        return false;
    // 跨立实验
    point L1 = l1.p[1] - l1.p[0];
    point h1 = l2.p[0] - l1.p[0], h2 = l2.p[1] - l1.p[0];
    if (dcmp(cross(L1, h1) * cross(L1, h2)) > 0) return false;
    point L2 = l2.p[1] - l2.p[0];
    h1 = l1.p[0] - l2.p[0]; h2 = l1.p[1] - l2.p[0];
    if (dcmp(cross(L2, h1) * cross(L2, h2)) > 0) return false;
    return true;
}

// 求两直线交点
bool inter_point(const Line &l1, const Line &l2, point &ans) {
    if (l1.k == l2.k) return false;
    if (l1.k == inf) {
        ans.x = l1.p[0].x;
        ans.y = l2.k * ans.x + l2.b;
    } else if (l2.k == inf) {
        ans.x = l2.p[0].x;
        ans.y = l1.k * ans.x + l1.b;
    } else {
        ans.x = (l1.b - l2.b) / (l2.k - l1.k);
        ans.y = l1.k * ans.x + l1.b;
    }
    return true;
}
```





## 直线和圆求交(斜率为0)

求直线和圆交点trick:可以先坐标轴变换，把直线变成水平直线 

判断 $n$ 个圆与一条直线所交线段是否存在交集

```cpp

auto check=[&](long double mid)->bool{
    long double line_y = line.p[0].y; // 获取水平线的 y 坐标
    long double a = -2e18, b = 2e18;// a, b 代表当前所有圆与直线交集的公共线段的左右端点x坐标初始化为无限大区间
    for (int i=0;i<n; ++i) {
        long double cx = cir[i].c.x;
        long double cy = cir[i].c.y;
        long double dist_sq = (cy - line_y) * (cy - line_y);//点到直线的垂直距离的平方
        if (mid * mid < dist_sq - EPS) return false;//如果垂直距离大于半径，圆与直线无交点
        long double half_width_sq = mid * mid - dist_sq;//计算圆与直线交点形成的线段，其沿x轴的“半宽度”的平方
        long double half_width = sqrtl(max((long double)0.0, half_width_sq));
        long double seg_a = cx - half_width;//当前圆与直线相交的线段 [seg_a, seg_b]
        long double seg_b = cx + half_width;
        a = max(a, seg_a);
        b = min(b, seg_b);
        if (a > b + EPS) return false;
    }
    return true;
}
```







## 圆(三点求圆心)

```cpp
template<typename T> struct Circle{
    Point<T> c;
    double r;
    Circle(){}
    Circle(Point<T> c ,double r):c(c),r(r){}
    inline Point<T> point(double p){
        return Point<T>(c.x+cos(p)*r,c.y+sin(p)*r);
    }
};

using circle = Circle<double>;

circle getcri(point p1 , point p2 , point p3) {
    double Bx = p2.x - p1.x , By = p2.y - p1.y;
    double Cx = p3.x - p1.x , Cy = p3.y - p1.y;
    double D = 2 * (Bx * Cy - By * Cx);
    double ansx = (Cy*(Bx*Bx+By*By) - By*(Cx*Cx+Cy*Cy))/D + p1.x;
    double ansy = (Bx*(Cx*Cx+Cy*Cy) - Cx*(Bx*Bx+By*By))/D + p1.y;
    point p(ansx,ansy);
    return circle(p,p.dis(p1));
}
```





## Graham 二维凸包

**最左最低点**为原点做极角排序，用叉积判断在以直线分割的哪个平面，如果在内侧，就弹出栈顶，知道在外侧为止

```cpp
vector<point> Graham(vector<point>&p){
    int idx =0;
    for(int i = 1;i<p.size();++i){
        if(p[i].y<p[idx].y||dcmp(p[i].y-p[idx].y)==0&&p[i].x<p[idx].x) idx = i;
    }
    swap(p[0],p[idx]);//p[0]设为最左最低点
    psort(p,p[0]);
    vector<point> st;
    st.emplace_back(p[0]);
    for(int i = 1;i<p.size();++i){
        while(st.size()>1&&cross(st.back()-st[st.size()-2],p[i]-st[st.size()-2])<=0) st.pop_back();
        st.emplace_back(p[i]);
    }
    return st;
}
```

