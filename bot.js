const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

const categories = {
    "9": "🌍 ידע כללי כללי",
    "21": "⚽ ספורט",
    "22": "🗺️ גאוגרפיה",
    "23": "📜 היסטוריה",
    "17": "🔬 מדע וטבע",
    "11": "🎬 סרטים וקולנוע"
};

const userStates = {};

// 🧠 מנוע תרגום מבוזר - שולח בקשה אחת ומפרק אותה כדי למנוע חסימות IP ב-Render
async function translatePayload(question, options) {
    try {
        // מחברים את השאלה והתשובות לטקסט אחד ארוך עם מפריד ייחודי (===)
        const combinedText = [question, ...options].join(' === ');
        const encodedText = encodeURIComponent(combinedText);
        
        // פנייה לשרת תרגום מבוזר שלא חוסם שרתי ענן
        const url = `https://lingva.ml/api/v1/en/he/${encodedText}`;
        const response = await axios.get(url, { timeout: 5000 });
        
        if (response.data && response.data.translation) {
            // מפרקים חזרה את התשובה המתורגמת
            const parts = response.data.translation.split(' === ').map(p => p.trim());
            if (parts.length === 5) {
                return { question: parts[0], options: parts.slice(1) };
            }
        }
        throw new Error("תרגום לא מלא");
    } catch (error) {
        console.log("שרת תרגום ראשי נכשל, מנסה שרת גיבוי מבוזר...");
        try {
            const combinedText = [question, ...options].join(' === ');
            const encodedText = encodeURIComponent(combinedText);
            const url = `https://translate.taragana.net/api/v1/en/he/${encodedText}`;
            const response = await axios.get(url, { timeout: 5000 });
            
            const parts = response.data.translation.split(' === ').map(p => p.trim());
            if (parts.length === 5) {
                return { question: parts[0], options: parts.slice(1) };
            }
            return null;
        } catch (inner) {
            console.log("כל שרתי התרגום חסמו את הבקשה כרגע.");
            return null;
        }
    }
}

function cleanText(text) {
    if (!text) return "";
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&ldquo;/g, '"')
        .replace(/&rdquo;/g, '"')
        .replace(/&rsquo;/g, "'");
}

bot.start((ctx) => {
    const userId = ctx.from.id;
    userStates[userId] = { score: 0, currentCategoryId: null, chatId: ctx.chat.id };
    ctx.reply(`ברוך הבא לבוט הטריוויה הדינמי! 🧠✨\nהשאלות נמשכות ממאגר עולמי ומתורגמות אוטומטית לעברית.`, 
        Markup.keyboard([['🎮 התחל משחק', '📊 הניקוד שלי']]).resize()
    );
});

bot.hears('🎮 התחל משחק', (ctx) => {
    const categoryButtons = Object.keys(categories).map(id => {
        return [Markup.button.callback(categories[id], `set_cat_${id}`)];
    });
    ctx.reply('בחר קטגוריית ידע כללי:', Markup.inlineKeyboard(categoryButtons));
});

bot.action(/^set_cat_(.+)$/, (ctx) => {
    const categoryId = ctx.match[1];
    const userId = ctx.from.id;

    userStates[userId] = { score: 0, currentCategoryId: categoryId, chatId: ctx.chat.id };
    ctx.answerCbQuery();
    ctx.reply(`מושך שאלה ממאגר האינטרנט ב-${categories[categoryId]} ומתרגם... ⏳`);
    sendNextQuestion(userId);
});

async function sendNextQuestion(userId) {
    const state = userStates[userId];
    if (!state || !state.currentCategoryId) return;

    try {
        // משיכה מהמאגר העולמי באינטרנט (OpenTDB)
        const url = `https://opentdb.com/api.php?amount=1&category=${state.currentCategoryId}&type=multiple`;
        const response = await axios.get(url);
        
        if (!response.data.results || response.data.results.length === 0) {
            bot.telegram.sendMessage(state.chatId, "תקלה במשיכת השאלה מהמאגר, מנסה שוב...");
            sendNextQuestion(userId);
            return;
        }

        const rawData = response.data.results[0];
        const questionText = cleanText(rawData.question);
        const correctAnswer = cleanText(rawData.correct_answer);
        const incorrectAnswers = rawData.incorrect_answers.map(cleanText);

        // ערבוב התשובות באנגלית מראש
        const allOptionsEnglish = [correctAnswer, ...incorrectAnswers];
        allOptionsEnglish.sort(() => Math.random() - 0.5); 
        const correctIndex = allOptionsEnglish.indexOf(correctAnswer);

        // שליחה לתרגום במכה אחת
        const translatedData = await translatePayload(questionText, allOptionsEnglish);

        // הגנה: אם התרגום נחסם לחלוטין, נדלג לשאלה הבאה כדי לא לתקוע את המשתמש באנגלית
        if (!translatedData) {
            console.log("דילוג על שאלה עקב חסימת תרגום.");
            sendNextQuestion(userId);
            return;
        }

        state.correctIndex = correctIndex;

        // שליחת ה-Quiz לטלגרם בעברית
        bot.telegram.sendQuiz(
            state.chatId,
            translatedData.question,
            translatedData.options,
            {
                correct_option_id: correctIndex,
                is_anonymous: false
            }
        );

    } catch (error) {
        console.error("שגיאה, מנסה שאלה אחרת:", error.message);
        setTimeout(() => { sendNextQuestion(userId); }, 1000);
    }
}

bot.on('poll_answer', (ctx) => {
    const pollAnswer = ctx.pollAnswer;
    const userId = pollAnswer.user.id;
    const state = userStates[userId];

    if (!state || state.correctIndex === undefined) return;

    if (pollAnswer.option_ids[0] === state.correctIndex) {
        state.score += 1;
    }

    setTimeout(() => {
        sendNextQuestion(userId);
    }, 1500);
});

bot.hears('📊 הניקוד שלי', (ctx) => {
    const userId = ctx.from.id;
    const score = userStates[userId] ? userStates[userId].score : 0;
    ctx.reply(`צברת בסבב הנוכחי: ${score} תשובות נכונות! 🏆`);
});

// 🌐 שרת חובה עבור Render כדי שהשירות יישאר חי בגרסה החינמית ולא יקרוס
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running online!\n');
}).listen(PORT, () => {
    console.log(`Server web interface active on port ${PORT}`);
});

bot.launch().then(() => {
    console.log('🚀 הבוט באוויר ב-Render! מבוסס מאגר חיצוני ותרגום מאוחד חסין חסימות.');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
