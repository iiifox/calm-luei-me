export async function onRequestGet({request}) {
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");

    // 可选参数：digits（验证码长度），period（周期秒数）
    const digits = parseInt(url.searchParams.get("digits") || "6", 10);
    const period = parseInt(url.searchParams.get("period") || "30", 10);

    if (!secret) {
        return jsonResponse({error: "缺少secret参数"}, 400);
    }

    if (isNaN(digits) || digits <= 0) {
        return jsonResponse({error: "digits 参数必须是正整数"}, 400);
    }
    if (isNaN(period) || period <= 0) {
        return jsonResponse({error: "period 参数必须是正整数"}, 400);
    }

    try {
        const {code, remaining} = await generateTOTP(secret, digits, period);
        return jsonResponse({code, remaining});
    } catch (err) {
        return jsonResponse({error: err.message}, 500);
    }

}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
        },
    });
}

/**
 * 生成TOTP验证码并返回剩余有效秒数
 */
async function generateTOTP(secret, digits = 6, period = 30) {
    const algorithm = "SHA-1";

    const now = Math.floor(Date.now() / 1000);
    const timeStep = Math.floor(now / period);
    const remaining = period - (now % period);

    const timeBuffer = new Uint8Array(8);
    for (let i = 7, t = timeStep; i >= 0; i--, t >>>= 8) {
        timeBuffer[i] = t & 0xff;
    }

    const keyBuffer = base32ToBytes(secret);
    const hmacBuffer = await hmac(keyBuffer, timeBuffer, algorithm);
    const otpValue = dynamicTruncate(hmacBuffer);

    const code = (otpValue % 10 ** digits).toString().padStart(digits, "0");
    return {code, remaining};
}

function base32ToBytes(base32) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0, value = 0;
    const output = [];

    for (const char of base32.toUpperCase().replace(/=+$/, "")) {
        const idx = alphabet.indexOf(char);
        if (idx < 0) throw new Error(`
    无效的Base32字符: ${char}`);
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(output);

}

async function hmac(key, data, algorithm) {
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        {name: "HMAC", hash: {name: algorithm}},
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, data);
    return new Uint8Array(signature);
}

function dynamicTruncate(bytes) {
    const offset = bytes[bytes.length - 1] & 0x0f;
    return (
        ((bytes[offset] & 0x7f) << 24) |
        ((bytes[offset + 1] & 0xff) << 16) |
        ((bytes[offset + 2] & 0xff) << 8) |
        (bytes[offset + 3] & 0xff)
    );
}
