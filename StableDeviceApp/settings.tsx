import React, { useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';

type ListItem = {
  id: string;
  avatar: string;
  title: string;
  subTitle: string;
  time: string;
  badge?: number;
};

const sourceData: ListItem[] = [
  {
    id: '1',
    avatar: 'https://picsum.photos/id/1012/100/100',
    title: '涂鸦智能【小程序 SDK】',
    subTitle: '星星的海：上面链接不要点，号刚找回…',
    time: '05/18',
    badge: 25,
  },
  {
    id: '2',
    avatar: 'https://picsum.photos/id/1025/100/100',
    title: '服务通知',
    subTitle: '功能内测通知：体验机会获得提醒',
    time: '02/27',
  },
  {
    id: '3',
    avatar: 'https://picsum.photos/id/1068/100/100',
    title: '群助手',
    subTitle: '',
    time: '02/02',
  },
  {
    id: '4',
    avatar: 'https://picsum.photos/id/1040/100/100',
    title: '工作群',
    subTitle: '领导：下午三点开会',
    time: '06/28',
  },
];

export default function Demo() {
  const [list, setList] = useState<ListItem[]>(sourceData);
  const openedRowRef = useRef<Swipeable | null>(null);

  const closeLastOpened = () => {
    if (openedRowRef.current) {
      openedRowRef.current.close();
    }
  };

  const renderRightActions = (item: ListItem) => {
    return (
      <View style={styles.actionWrap}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.btnTop]}
          onPress={() => alert(`置顶：${item.title}`)}
        >
          <Text style={styles.btnText}>置顶</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.btnUnread]}
          onPress={() => alert(`标为未读：${item.title}`)}
        >
          <Text style={styles.btnText}>标为未读</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.btnDelete]}
          onPress={() => {
            setList(prev => prev.filter(row => row.id !== item.id));
          }}
        >
          <Text style={styles.btnText}>删除</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderRow = ({ item }: { item: ListItem }) => {
    return (
      <Swipeable
        ref={(ref) => {
          if (ref) openedRowRef.current = ref;
        }}
        friction={2}
        rightThreshold={80}
        renderRightActions={() => renderRightActions(item)}
        onSwipeableWillOpen={closeLastOpened}
      >
        <View style={styles.rowContent}>
          <View style={styles.avatarBox}>
            <Image source={{ uri: item.avatar }} style={styles.avatar} />
            {item.badge && (
              <View style={styles.badge}>
                <Text style={styles.badgeTxt}>{item.badge}</Text>
              </View>
            )}
          </View>
          <View style={styles.textWrap}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.time}>{item.time}</Text>
            </View>
            {item.subTitle ? (
              <Text style={styles.sub} numberOfLines={1}>{item.subTitle}</Text>
            ) : null}
          </View>
        </View>
      </Swipeable>
    );
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <FlatList
        data={list}
        renderItem={renderRow}
        keyExtractor={i => i.id}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
  },
  avatarBox: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#f43f3b',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeTxt: {
    color: '#fff',
    fontSize: 12,
  },
  textWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    color: '#1a1a1a',
    flexShrink: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 13,
    color: '#999',
  },
  sub: {
    fontSize: 14,
    color: '#808080',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#eeeeee',
    marginLeft: 84,
  },
  actionWrap: {
    flexDirection: 'row',
    height: '100%',
  },
  actionBtn: {
    width: 90,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
  },
  btnTop: {
    backgroundColor: '#0088ee',
  },
  btnUnread: {
    backgroundColor: '#ffb000',
  },
  btnDelete: {
    backgroundColor: '#ff4522',
  },
});
