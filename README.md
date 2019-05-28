``` js
const Weibo = require('sina-weibo')
var weibo = new Weibo({
	username: 'xxx',
	password: 'yyy',
	async onNeedPinCode(url) {
		console.log('需要输入验证码:')
		console.log(url')
		return 'aabb';
	}
})
async function main() {
	await weibo.checkLogin();
	let mid = await weibo.mblogAdd(`测试发布一条微博`);
	console.log('发微博成功');
	await weibo.commentAdd(mid, '文字评论');
	console.log('文字评论');
	let pid = await weibo.upload(fs.readFileSync('a.png', 'base64'))
	await weibo.commentAdd(mid, '图片评论', pid);
	console.log('图片评论');
}
main()
```