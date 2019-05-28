const axios = require('axios');
const sinaSSOEncoder = require('./sinaSSOEncoder.js');
const querystring = require('querystring');
const axiosCookieJarSupport = require('axios-cookiejar-support').default;
const tough = require('tough-cookie');
const FileCookieStore = require("tough-cookie-filestore");
const path = require('path');
const fs = require('fs');
const readline = require('readline');

function inputPinCode(url) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise((resolve, reject) => {
		rl.question(`验证码链接: \n${url}\n请输入验证码: `, (pinCode) => {
			console.log(`你输入的验证码为：${pinCode}`);
			rl.close();
			resolve(pinCode);
		});
	});
}

class Weibo {
	/**
	 * @param {object} conf
	 * @param {string} conf.username
	 * @param {string} conf.password 
	 * @param {(url:string)=>Promise<string>} [conf.onNeedPinCode]
	 */
	constructor(conf) {
		this.username = conf.username;
		this.password = conf.password;
		this.onNeedPinCode = conf.onNeedPinCode || inputPinCode;
		let filename = path.join(__dirname, conf.username + ".json");
		if (!fs.existsSync(filename)) fs.writeFileSync(filename, '{}');
		this.cookieJar = new tough.CookieJar(new FileCookieStore(filename));
		this.axios = axios.default.create();
		axiosCookieJarSupport(this.axios);
		this.axios.defaults.jar = this.cookieJar;
		this.axios.defaults.withCredentials = true;
		this.axios.defaults.headers = {
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
			'Referer': 'https://weibo.com/friends',
		};
	}
	/**
	 * login and save cookie to file
	 */
	async login() {
		let username = this.username;
		let password = this.password;
		if (!username) throw '账号不能为空';
		let RSAKey = new sinaSSOEncoder.RSAKey();
		let encodeUserName = new Buffer(encodeURIComponent(this.username)).toString('base64');
		let preLoginUrl = 'http://login.sina.com.cn/sso/prelogin.php?entry=weibo&checkpin=1&callback=sinaSSOController.preloginCallBack&rsakt=mod&client=ssologin.js(v1.4.18)&su=' + encodeUserName;
		let preLoginResp = await this.axios.get(preLoginUrl);
		let preContentRegex = /\((.*?)\)/g;
		let patten = preContentRegex.exec(preLoginResp.data);
		let { nonce, pubkey, servertime, rsakv, pcid, showpin } = JSON.parse(patten[1]);
		RSAKey.setPublic(pubkey, "10001");
		let passwd = RSAKey.encrypt([servertime, nonce].join("\t") + "\n" + password);
		username = new Buffer(encodeURIComponent(username)).toString('base64');
		let data = {
			'entry': 'weibo',
			'gateway': '1',
			'from': '',
			'savestate': '7',
			'useticket': '1',
			'pagerefer': 'http://weibo.com/p/1005052679342531/home?from=page_100505&mod=TAB&pids=plc_main',
			'vsnf': '1',
			'su': username,
			'service': 'miniblog',
			'servertime': servertime,
			'nonce': nonce,
			'pwencode': 'rsa2',
			'rsakv': rsakv,
			'sp': passwd,
			'sr': '1366*768',
			'encoding': 'UTF-8',
			'prelt': '115',
			'url': 'http://weibo.com/ajaxlogin.php?framelogin=1&callback=parent.sinaSSOController.feedBackUrlCallBack',
			'returntype': 'META'
		};
		if (showpin) {
			let url = `http://login.sina.com.cn/cgi/pin.php?r=${Math.floor(Math.random() * 1e8)}&s=0&p=${pcid}`;
			data['door'] = await this.onNeedPinCode(url);
			data['pcid'] = pcid;
		}
		let url = 'http://login.sina.com.cn/sso/login.php?client=ssologin.js(v1.4.18)';
		let loginResp = await this.axios.post(url, querystring.stringify(data));
		let m = /location.replace\(\'(.*?)\'\)/g.exec(loginResp.data);
		if (!m) throw '登录失败,密码错误';
		await this.axios.get(m[1], { jar: this.cookieJar, withCredentials: true }).catch(e => e);
	}
	/**
	 * 
	 * @param {number} [retry=3] 
	 * @returns {boolean}
	 */
	async checkLogin(retry) {
		retry = retry == null ? 1 : retry;
		let { data } = await this.axios.get(`https://weibo.com`, { maxRedirects: 1, validateStatus: () => true });
		let m = /\$CONFIG\['uid'\]='(\d+)';/.exec(data);
		if (m) {
			this.uid = m[1];
			return true;
		}
		if (!retry--) return false;
		try {
			await this.login();
		} catch (error) {
			return false;
		}
		return this.checkLogin(retry);
	}
	/**
	 * @param {string} b64_data picture base64
	 * @return {Promise<string>} pid
	 */
	async upload(b64_data) {
		let imageUrl = 'http://picupload.service.weibo.com/interface/pic_upload.php?mime=image%2Fjpeg&data=base64&url=0&markpos=1&logo=&nick=0&marks=1&app=miniblog';
		let upImgResp = await this.axios.post(imageUrl, querystring.stringify({ b64_data }));
		let { data } = JSON.parse(upImgResp.data.replace(/([\s\S]*)<\/script>/g, ''));
		if (data.count == -11) {
			throw '格式不支持';
		}
		if (data.count == -1) {
			throw '新浪账号过期';
		}
		if (data.count < 1) {
			throw '上传失败:错误代码' + data.count;
		}
		return data['pics']['pic_1']['pid'];
	}
	/**
	 * 发微博 返回微博ID
	 * @param {string} text 微博文本
	 * @param {string[]} [pics] 微博图片 ['bfdf4e9fgy1fze0606s4kj206u01lt8l', 'bfdf4e9fgy1fze062zw58j208001wdft']
	 */
	async mblogAdd(text, pics) {
		let form = { text };
		if (pics && pics.length) {
			form.pic_id = pics.join('|');
			form.updata_img_num = pics.length;
		}
		let { data } = await this.axios.post(`https://weibo.com/aj/mblog/add?ajwvr=6`, querystring.stringify(form));
		let m = /mid="?(\d+)/.exec(data.data.html);
		if (m) return m[1];
		console.error(`mblogAdd: ${data.code} ${data.msg}`);
	}
	/**
	 * 评论 返回评论ID
	 * @param {string} mid 
	 * @param {string} content 
	 * @param {string} [pic_id] 
	 */
	async commentAdd(mid, content, pic_id) {
		let form = {
			mid,
			uid: this.uid,
			content,
			pic_id,
		};
		let { data } = await this.axios.post('https://weibo.com/aj/v6/comment/add?ajwvr=6', querystring.stringify(form));
		let m = /comment_id="?(\d+)/.exec(data.data.comment);
		if (m) return m[1];
		console.error(`commentAdd: ${data.code} ${data.msg}`);
	}
}
module.exports = Weibo;