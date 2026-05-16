const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// Categories mapping from the global Trivia API
const categories = {
    "9": "🌍 General Knowledge",
    "21": "⚽ Sports",
    "22": "🗺️ Geography",
    "23": "📜 History",
    "17": "🔬 Science & Nature",
    "11": "🎬 Movies & Cinema"
};

const userStates = {};

// Function to clean HTML entities from the API response
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
    
    ctx.reply(`Welcome to the Trivia Bot! 🧠✨\nQuestions are fetched in real-time from a global database.`, 
        Markup.keyboard([['🎮 Start Game', '📊 My Score']]).resize()
    );
});

bot.hears('🎮 Start Game', (ctx) => {
    const categoryButtons = Object.keys(categories).map(id => {
        return [Markup.button.callback(categories[id], `set_cat_${id}`)];
    });
    ctx.reply('Choose a category:', Markup.inlineKeyboard(categoryButtons));
});

bot.action(/^set_cat_(.+)$/, (ctx) => {
    const categoryId = ctx.match[1];
    const userId = ctx.from.id;

    userStates[userId] = { score: 0, currentCategoryId: categoryId, chatId: ctx.chat.id };
    ctx.answerCbQuery();
    ctx.reply(`Loading question from ${categories[categoryId]}... ⏳`);
    sendNextQuestion(userId);
});

async function sendNextQuestion(userId) {
    const state = userStates[userId];
    if (!state || !state.currentCategoryId) return;

    try {
        // Fetching 1 multiple-choice question from the global API
        const url = `https://opentdb.com/api.php?amount=1&category=${state.currentCategoryId}&type=multiple`;
        const response = await axios.get(url);
        
        if (!response.data.results || response.data.results.length === 0) {
            bot.telegram.sendMessage(state.chatId, "Database error, trying again...");
            sendNextQuestion(userId);
            return;
        }

        const rawData = response.data.results[0];
        const questionText = cleanText(rawData.question);
        const correctAnswer = cleanText(rawData.correct_answer);
        const incorrectAnswers = rawData.incorrect_answers.map(cleanText);

        // Mix choices
        const allOptions = [correctAnswer, ...incorrectAnswers];
        allOptions.sort(() => Math.random() - 0.5); 
        const correctIndex = allOptions.indexOf(correctAnswer);

        state.correctIndex = correctIndex;

        // Send native Telegram quiz
        bot.telegram.sendQuiz(
            state.chatId,
            questionText,
            allOptions,
            {
                correct_option_id: correctIndex,
                is_anonymous: false
            }
        );

    } catch (error) {
        console.error("Error fetching question:", error.message);
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

bot.hears('📊 My Score', (ctx) => {
    const userId = ctx.from.id;
    const score = userStates[userId] ? userStates[userId].score : 0;
    ctx.reply(`Your current score is: ${score} correct answers! 🏆`);
});

// HTTP Server required by Render to keep the service alive
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Online\n');
}).listen(PORT);

bot.launch().then(() => {
    console.log('🚀 Trivia Bot is online on Render! Native English mode.');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
