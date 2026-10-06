// Exact non-negative decimal arithmetic. No floating point in price calculations.
const gcd=(a,b)=>{while(b){[a,b]=[b,a%b];}return a||1n;};
export class Decimal {
  constructor(n,d=1n){if(d===0n)throw new Error('計算分母不可為零');const g=gcd(n,d);this.n=n/g;this.d=d/g;}
  static from(value){const [a,b='']=String(value).split('.');return new Decimal(BigInt(a+b),10n**BigInt(b.length));}
  add(v){return new Decimal(this.n*v.d+v.n*this.d,this.d*v.d);}
  sub(v){return new Decimal(this.n*v.d-v.n*this.d,this.d*v.d);}
  mul(v){return new Decimal(this.n*v.n,this.d*v.d);}
  div(v){return new Decimal(this.n*v.d,this.d*v.n);}
  fixed(digits=2,ceil=false){
    if(this.n<0n || this.d<0n || this.n>9007199254740991n*this.d)throw new Error('計算結果超出可安全顯示範圍，請縮小輸入');
    const scale=10n**BigInt(digits), num=this.n*scale;
    const rounded=ceil?(num+this.d-1n)/this.d:(num*2n+this.d)/(this.d*2n);
    const text=rounded.toString().padStart(digits+1,'0');
    return digits?text.slice(0,-digits)+'.'+text.slice(-digits):text;
  }
}
