import TelegramBot from 'node-telegram-bot-api';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const youtube = google.youtube({
  version: 'v3',
  auth: YOUTUBE_API_KEY
});

async function getChannelId() {
  const res = await youtube.search.list({
    part: 'snippet',
    q: 'MrLololoshka',
    type: 'channel'
  });

  if (res.data.items.length > 0) {
    const channelId = res.data.items[0].id.channelId;
    console.log(`ID канала: ${channelId}`);
    return channelId;
  } else {
    console.log('Канал не найден');
    return null;
  }
}
const CHANNEL_ID = await getChannelId();

// Функция для получения плейлистов канала
// Функция для получения плейлистов канала
async function getPlaylists() {
  const res = await youtube.playlists.list({
    part: 'snippet',
    channelId: CHANNEL_ID,
    maxResults: 50
  });

  // Фильтрация плейлистов по условию и ограничение до 7 плейлистов
  const playlists = res.data.items
    .filter(item => item.snippet.title.startsWith('Lp'))
    .slice(0, 7) // Берем только первые 7 плейлистов
    .reverse()
    .map((item, index) => {
      console.log(`Playlist ${index + 1}: ${item.id} - ${item.snippet.title}`); // Логирование всех плейлистов
      return {
        id: item.id,
        title: `Сезон ${index + 1}`
      };
    });

  return playlists;
}

// Функция для получения видео в плейлисте
async function getPlaylistVideos(playlistId) {
  let videos = [];
  let pageToken = '';

  while (true) {
    try {
      console.log(`Requesting playlistId: ${playlistId}`); // Логирование playlistId
      const res = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId: playlistId,
        maxResults: 50, // Увеличиваем лимит до 50 видео
        pageToken: pageToken
      });

      if (res.data.items.length === 0) {
        console.log(`No videos found in playlistId: ${playlistId}`);
        break;
      }

      videos = videos.concat(res.data.items.map((item, index) => ({
        id: item.snippet.resourceId.videoId,
        title: `№ ${videos.length + index + 1}`
      })));

      pageToken = res.data.nextPageToken;
      if (!pageToken) break; // Прекращаем, когда больше нет страниц
    } catch (error) {
      console.error(`Error fetching playlist videos for playlistId: ${playlistId}: ${error.message}`);
      break;
    }
  }

  return videos;
}


// Функция для создания инлайн-кнопок
function createInlineButtons(items, callbackDataPrefix) {
  const buttons = items.map(item => ([{
    text: item.title,
    // Передаем данные в формате JSON
    callback_data: JSON.stringify({
      a: callbackDataPrefix,
      id: item.id
    })
  }]));

  return {
    inline_keyboard: buttons
  };
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const playlists = await getPlaylists();

  const replyMarkup = createInlineButtons(playlists, 'playlist');
  bot.sendMessage(chatId, 'Выберите плейлист:', {
    reply_markup: replyMarkup
  });
});

// Функция для создания сетки с сериями
function createEpisodeGrid(videos, currentPage = 0) {
  const MAX_EPISODES_PER_PAGE = 15;
  const EPISODES_PER_ROW = 5;
  
  const start = currentPage * MAX_EPISODES_PER_PAGE;
  const end = Math.min(start + MAX_EPISODES_PER_PAGE, videos.length);

  const grid = [];
  for (let i = start; i < end; i += EPISODES_PER_ROW) {
    const row = videos.slice(i, i + EPISODES_PER_ROW).map(item => ({
      text: item.title,
      callback_data: JSON.stringify({
        a: 'v',
        id: item.id,
        page: currentPage
      })
    }));
    grid.push(row);
  }

  return grid;
}

// Функция для создания кнопок пагинации
function createPaginationButtons(videos, currentPage = 0, playlistId) {
  const MAX_EPISODES_PER_PAGE = 15;
  const MAX_BUTTONS_PER_ROW = 5; // Максимум 5 кнопок на строку
  const totalPages = Math.ceil(videos.length / MAX_EPISODES_PER_PAGE);
  
  const paginationButtons = [];
  for (let i = 0; i < totalPages; i++) {
    const start = i * MAX_EPISODES_PER_PAGE + 1;
    const end = Math.min(start + MAX_EPISODES_PER_PAGE - 1, videos.length);
    paginationButtons.push({
      text: `${start}...${end}`,
      callback_data: JSON.stringify({
        a: 'p',
        pg: i,
        id: playlistId // Добавляем id плейлиста
      })
    });
  }

  // Разделяем кнопки пагинации по строкам (максимум 5 кнопок на строку)
  const paginationRows = [];
  for (let i = 0; i < paginationButtons.length; i += MAX_BUTTONS_PER_ROW) {
    paginationRows.push(paginationButtons.slice(i, i + MAX_BUTTONS_PER_ROW));
  }

  return paginationRows;
}

// Функция для создания инлайн-кнопок с сеткой и пагинацией
function createInlineButtonsWithGridAndPagination(videos, currentPage = 0, playlistId) {
  const grid = createEpisodeGrid(videos, currentPage);
  const pagination = createPaginationButtons(videos, currentPage, playlistId);

  // Добавляем разделитель
  const separator = [{ text: '—', callback_data: 'separator' }];

  return {
    inline_keyboard: [...grid, separator, ...pagination]
  };
}


// Обработка нажатий на кнопки
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  try {
    const data = JSON.parse(query.data);

    if (data.a === 'playlist') {
      const playlistId = data.id;

      // Получаем видео для выбранного плейлиста
      const videos = await getPlaylistVideos(playlistId);

      // Создаем кнопки для первой страницы и передаем ID плейлиста
      const videoButtons = createInlineButtonsWithGridAndPagination(videos, 0, playlistId);

      await bot.deleteMessage(chatId, query.message.message_id);
      bot.sendMessage(chatId, 'Выберите серию:', {
        reply_markup: videoButtons
      });
    } else if (data.a === 'p') {
      const currentPage = data.pg;
      const playlistId = data.id;

      // Получаем видео для текущего плейлиста
      const videos = await getPlaylistVideos(playlistId);

      // Создаем кнопки для выбранной страницы и передаем ID плейлиста
      const videoButtons = createInlineButtonsWithGridAndPagination(videos, currentPage, playlistId);

      await bot.editMessageReplyMarkup({
        inline_keyboard: videoButtons.inline_keyboard
      }, {
        chat_id: chatId,
        message_id: query.message.message_id
      });
    }
  } catch (error) {
    console.error('Ошибка при обработке данных:', error);
  }
});