class TwitchApi {
  constructor(config) {
    this.config = config;
    this.accessToken = '';
    this.expiresAt = 0;
  }

  async getAppAccessToken() {
    if (this.accessToken && Date.now() < this.expiresAt) {
      return this.accessToken;
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      return '';
    }

    const url = new URL('https://id.twitch.tv/oauth2/token');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('client_secret', this.config.clientSecret);
    url.searchParams.set('grant_type', 'client_credentials');

    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Twitch auth failed with ${response.status}`);
    }

    const payload = await response.json();
    this.accessToken = payload.access_token || '';
    this.expiresAt = Date.now() + Math.max((payload.expires_in || 0) - 60, 60) * 1000;
    return this.accessToken;
  }

  async getStreamContext(channel) {
    if (!this.config.clientId || !this.config.clientSecret || !channel) {
      return {
        live: false,
        title: '',
        gameName: '',
        userName: channel
      };
    }

    const accessToken = await this.getAppAccessToken();
    const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': this.config.clientId
      }
    });

    if (!response.ok) {
      throw new Error(`Twitch streams API failed with ${response.status}`);
    }

    const payload = await response.json();
    const stream = Array.isArray(payload.data) ? payload.data[0] : null;

    if (!stream) {
      return {
        live: false,
        title: '',
        gameName: '',
        userName: channel
      };
    }

    return {
      live: true,
      title: stream.title || '',
      gameName: stream.game_name || '',
      userName: stream.user_name || channel
    };
  }
}

module.exports = {
  TwitchApi
};
