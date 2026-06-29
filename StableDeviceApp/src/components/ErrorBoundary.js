/**
 * ErrorBoundary - 全局错误捕获
 *
 * 作用:
 * - 捕获子组件树中的渲染错误(render/lifecycle)
 * - 显示错误信息而不是白屏/闪退
 * - 让我们能定位崩溃根因
 *
 * 不能捕获:
 * - Event handlers (onPress 等)
 * - Async code (setTimeout, Promise)
 * - 自身错误
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', info?.componentStack);
    this.setState({ info });
  }

  reset = () => {
    this.setState({ hasError: false, error: null, info: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>应用发生错误</Text>
          <Text style={styles.subtitle}>请截图此页发送给开发者</Text>
          <ScrollView style={styles.scroll}>
            <Text style={styles.label}>错误信息:</Text>
            <Text style={styles.errorText}>
              {String(this.state.error?.toString() || 'Unknown')}
            </Text>
            {this.state.error?.stack && (
              <>
                <Text style={styles.label}>调用栈:</Text>
                <Text style={styles.stackText}>{this.state.error.stack}</Text>
              </>
            )}
            {this.state.info?.componentStack && (
              <>
                <Text style={styles.label}>组件树:</Text>
                <Text style={styles.stackText}>
                  {this.state.info.componentStack}
                </Text>
              </>
            )}
          </ScrollView>
          <TouchableOpacity style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#d32f2f',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    marginBottom: 16,
  },
  scroll: {
    flex: 1,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    padding: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1976d2',
    marginTop: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#d32f2f',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  stackText: {
    fontSize: 11,
    color: '#333',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  button: {
    backgroundColor: '#1976d2',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ErrorBoundary;
