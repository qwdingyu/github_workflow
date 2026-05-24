const config = {
  telegram: {
    handle: "@eforge_shop",
    url: "https://t.me/eforge_shop"
  },
  products: [
    {
      name: "视频会员月卡",
      tag: "热门",
      price: "29",
      unit: "月",
      summary: "适合先体验会员权益，承接短期拉新和活动转化。",
      bullets: ["会员内容入口", "资料更新提醒", "社群公告"],
      accent: "mint",
      buyUrl: "https://www.baidu.com/s?wd=%E8%A7%86%E9%A2%91%E4%BC%9A%E5%91%98"
    },
    {
      name: "效率资料包",
      tag: "资料",
      price: "39",
      unit: "份",
      summary: "面向想快速获取模板、清单、教程和可复用资料的用户。",
      bullets: ["精选资料合集", "下载入口跳转", "后续更新通知"],
      accent: "amber",
      buyUrl: "https://www.baidu.com/s?wd=%E8%99%9A%E6%8B%9F%E8%B5%84%E6%96%99%E5%8C%85"
    },
    {
      name: "会员资料组合包",
      tag: "推荐",
      price: "69",
      unit: "套",
      summary: "把会员和资料打包，适合主推商品和单页投放。",
      bullets: ["会员权益", "资料合集", "Telegram 群更新"],
      accent: "blue",
      buyUrl: "https://www.baidu.com/s?wd=%E4%BC%9A%E5%91%98%E8%B5%84%E6%96%99%E7%BB%84%E5%90%88%E5%8C%85"
    }
  ]
};

const productGrid = document.querySelector("#productGrid");
const telegramLink = document.querySelector("#telegramLink");
const heroTelegramLink = document.querySelector("#heroTelegramLink");
const telegramHandle = document.querySelector("#telegramHandle");

function createProductCard(product) {
  const article = document.createElement("article");
  article.className = `product-card accent-${product.accent}`;

  const bullets = product.bullets.map((item) => `<li>${item}</li>`).join("");

  article.innerHTML = `
    <div class="product-cover" aria-hidden="true">
      <span>${product.tag}</span>
      <strong>${product.name}</strong>
    </div>
    <div class="product-body">
      <div class="product-title-row">
        <h3>${product.name}</h3>
        <span>${product.tag}</span>
      </div>
      <p>${product.summary}</p>
      <ul>${bullets}</ul>
      <div class="price-row">
        <span class="price"><small>¥</small>${product.price}</span>
        <span class="unit">/${product.unit}</span>
      </div>
      <a class="button primary full" href="${product.buyUrl}" target="_blank" rel="noopener noreferrer">购买跳转</a>
    </div>
  `;

  return article;
}

function renderProducts() {
  const fragment = document.createDocumentFragment();
  for (const product of config.products) {
    fragment.appendChild(createProductCard(product));
  }
  productGrid.replaceChildren(fragment);
}

function renderTelegram() {
  telegramLink.href = config.telegram.url;
  heroTelegramLink.href = config.telegram.url;
  heroTelegramLink.target = "_blank";
  heroTelegramLink.rel = "noopener noreferrer";
  telegramHandle.textContent = config.telegram.handle;
}

renderProducts();
renderTelegram();
